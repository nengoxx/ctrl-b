import { PCM_WORKLET_NAME, PCM_WORKLET_SOURCE } from "./pcmWorklet";

// THE CALL'S EAR, client side (Phase 24 / D71 §3.1 · §4.1 · §4.3) — one `getUserMedia`, one
// `AudioContext`, one worklet, and the two things the machine upstairs needs from them: a stream of
// `frame_ms` pcm16 frames with their RMS, and the honest answer to "is this track's echo cancellation
// the subtractive `all` mode".
//
// SEPARATE FROM `useDictation` BY DESIGN, not by accident: that hook owns a `MediaRecorder` producing
// whole opus CLIPS for the HTTP `/voice/stt` door, and this produces a continuous raw-pcm uplink. They
// share nothing but the permission, and only one of them is ever live at a time. What this does NOT do
// is change dictation's own constraints — R51 §6.1's finding (dictation passes none) is a deferred
// residual, not this slice's business.
//
// THE ECHO READBACK IS THE BARGE-IN GATE (§7-S0 ③, owner's device round): Chrome honours
// `echoCancellation: {ideal: "all"}` and genuinely SUBTRACTS the page's own playback, so the mic can stay
// open while the reply speaks and voice barge-in is viable. Fennec coerces the string to `true` and its
// AEC measurably does nothing against the phone's own output. So the capability is READ BACK per track
// (never UA-sniffed) and handed up; the machine arms the automatic interrupt only on `"all"`.

/** One uplink frame: pcm16 LE mono bytes, plus the RMS of the same samples (§4.3's energy gate reuses
 *  the worklet's own pass — there is deliberately no second AnalyserNode measuring the same audio). */
export interface PcmFrame {
  buf: ArrayBuffer;
  rms: number;
}

export interface PcmCapture {
  /** The context's REAL rate — what `start.sample_rate` must declare (§3.1: the browser gives 44.1k or
   *  48k by device and there is no reliable way to ask for 24k, so the relay resamples from this). */
  sampleRate: number;
  /** `getSettings().echoCancellation` for the live track: `"all"` on a Chromium that granted the
   *  system-loopback mode, `true`/`false` on a boolean-only implementation, `undefined` when the browser
   *  reports nothing at all. The one input to the trigger-A arming decision. */
  echoCancellation: string | boolean | undefined;
  /** Release everything: the worklet, the graph, the context, the track, and the Blob URL. Idempotent. */
  stop: () => void;
}

export interface PcmCaptureOpts {
  /** Uplink frame duration, from `/voice/status.live_call.frame_ms`. Never a constant in here. */
  frameMs: number;
  onFrame: (frame: PcmFrame) => void;
  /** The track ENDED on its own — permission revoked, a real phone call stole the mic, a headset
   *  unplugged (§4.5's capture-loss rule: the call ends in `error` with a plain reason). */
  onEnded: () => void;
}

/**
 * Open the call's capture chain. Throws whatever `getUserMedia` throws (a denied permission, an absent
 * device) — the caller renders that as the call's error terminal; everything it allocated before a later
 * failure is released on the way out.
 */
export async function startPcmCapture(opts: PcmCaptureOpts): Promise<PcmCapture> {
  // §4.1's constraints. `echoCancellation: {ideal: "all"}` is NOT expressible in TS's `ConstrainBoolean`
  // — the mode string is a Chromium extension of the spec's boolean slot — and the WebIDL degradation is
  // exactly what we want elsewhere (a string handed to Firefox's boolean slot casts to `true`). So the
  // constraint object is built as-is and narrowed once, here, with the reason attached rather than
  // spread through the file.
  const audio = {
    echoCancellation: { ideal: "all" },
    noiseSuppression: true,
    channelCount: 1,
  } as unknown as MediaTrackConstraints;
  const stream = await navigator.mediaDevices.getUserMedia({ audio });
  const track = stream.getAudioTracks()[0];

  let ctx: AudioContext | null = null;
  let url: string | null = null;
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    for (const t of stream.getTracks()) t.stop();
    if (ctx) void ctx.close().catch(() => {});
    if (url) URL.revokeObjectURL(url);
  };

  try {
    ctx = new AudioContext();
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    // A context that will not run is a SILENT CALL: the graph builds, the worklet installs, and not one
    // frame is ever pulled — the overlay would reach "Listening" and sit there forever with a dead ear.
    // Failing the start instead puts it where the owner can see it (the call's error terminal). The
    // gesture unlock this needs is `primeAudio`'s job, inside the tap; there is no second chance here.
    if (ctx.state !== "running") throw new Error("audio context suspended");
    url = URL.createObjectURL(new Blob([PCM_WORKLET_SOURCE], { type: "text/javascript" }));
    await ctx.audioWorklet.addModule(url);
    const frameSamples = Math.max(1, Math.round((ctx.sampleRate * opts.frameMs) / 1000));
    const node = new AudioWorkletNode(ctx, PCM_WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      processorOptions: { frameSamples },
    });
    node.port.onmessage = (e: MessageEvent<PcmFrame>) => {
      if (!stopped) opts.onFrame(e.data);
    };
    ctx.createMediaStreamSource(stream).connect(node);
    // A worklet is only PULLED while it is reachable from the destination, so the chain has to terminate
    // there — through a muted gain, because "reachable" must not also mean "audible". The processor
    // writes no output at all (its `outputs` stay zero-filled), so this path carries silence twice over;
    // the gain is the part that does not depend on that staying true.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute);
    mute.connect(ctx.destination);
    track.addEventListener("ended", () => {
      if (!stopped) opts.onEnded();
    });
    return {
      sampleRate: ctx.sampleRate,
      echoCancellation: track.getSettings().echoCancellation,
      stop,
    };
  } catch (e) {
    stop();
    throw e;
  }
}
