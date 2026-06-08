// Utils tab. Phase 1 renders the Vapor tool cards statically for fidelity (D7); the extensible
// tool registry (yt_captions, ip_info, dns_trace, …) that drives these from the backend is
// Phase 8. Inputs/buttons are inert placeholders for now.

interface Props {
  active: boolean;
}

export function UtilsTab({ active }: Props) {
  return (
    <div
      className={"tab" + (active ? " active" : "")}
      id="tab-utils"
      data-screen-label="03 Utils"
      role="tabpanel"
      aria-labelledby="tabbtn-utils"
    >
      <div className="sec">
        <span className="num">03</span>
        <b>Utils</b>
        <span className="right">sandbox tools</span>
      </div>

      <div className="util">
        <div className="uhead">
          <div className="glyph">
            <span className="ico yt" />
          </div>
          <div className="t">
            <div className="nm">yt captions</div>
            <div className="desc">paste url · dump as json</div>
          </div>
        </div>
        <div className="ubody">
          <div className="field">
            <input type="text" placeholder="https://youtube.com/watch?v=…" disabled />
            <button disabled>fetch</button>
          </div>
          <div className="result">
            <div style={{ color: "var(--ink-faint)", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase" }}>
              // tool registry — phase 8
            </div>
          </div>
        </div>
      </div>

      <div className="util">
        <div className="uhead">
          <div className="glyph">
            <span className="ico globe" />
          </div>
          <div className="t">
            <div className="nm">ip lookup</div>
            <div className="desc">placeholder · whois &amp; geoip</div>
          </div>
        </div>
        <div className="ubody">
          <div className="field">
            <input type="text" placeholder="1.1.1.1 or 192.168.1.10" disabled />
            <button disabled>lookup</button>
          </div>
          <div className="result">
            <div style={{ color: "var(--ink-faint)", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase" }}>
              // tool registry — phase 8
            </div>
          </div>
        </div>
      </div>

      <div style={{ height: 24 }} />
    </div>
  );
}
