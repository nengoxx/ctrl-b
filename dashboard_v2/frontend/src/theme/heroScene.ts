// The hero's decorative scene — sun + both skyline SVGs — lifted VERBATIM from vapor.html
// (lines ~1096–1395). Injected via dangerouslySetInnerHTML so the exact SVG markup, gradient
// ids (#mtn-far, #city-mid, …) and classes (.skyline-mountains/.skyline-city) survive intact
// for the CSS in vapor.css to theme + toggle. Pure decoration — no behavior, no data (D7).

export const SKY_INNER_HTML = `
<div class="sun"></div>
<!-- MOUNTAINS — 3 ridges of decreasing distance, each with its own neon outline -->
<svg class="skyline skyline-mountains" viewBox="0 0 200 56" preserveAspectRatio="none" aria-hidden="true">
  <defs>
    <linearGradient id="mtn-far" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#6e3aa8"/><stop offset="100%" stop-color="#3f1d70"/>
    </linearGradient>
    <linearGradient id="mtn-back" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#4a2080"/><stop offset="100%" stop-color="#26124a"/>
    </linearGradient>
    <linearGradient id="mtn-mid" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2a1052"/><stop offset="100%" stop-color="#10052a"/>
    </linearGradient>
    <linearGradient id="mtn-fore" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#10052a"/><stop offset="100%" stop-color="#04010a"/>
    </linearGradient>
  </defs>

  <path d="M 0,56 L 0,38 L 15,32 L 30,36 L 50,28 L 70,32 L 90,26 L 110,30 L 130,24 L 150,28 L 170,26 L 190,30 L 200,28 L 200,56 Z" fill="url(#mtn-far)"/>
  <path class="edge" d="M 0,38 L 15,32 L 30,36 L 50,28 L 70,32 L 90,26 L 110,30 L 130,24 L 150,28 L 170,26 L 190,30 L 200,28" stroke="rgba(255,82,212,0.28)" stroke-width="0.4" vector-effect="non-scaling-stroke"/>

  <g>
    <polygon points="-10,56 8,26 32,56" fill="url(#mtn-back)"/>
    <polyline class="edge" points="-10,56 8,26 32,56" stroke="rgba(255,82,212,0.45)" stroke-width="0.55" vector-effect="non-scaling-stroke"/>

    <polygon points="14,56 36,22 54,56" fill="url(#mtn-back)"/>
    <polyline class="edge" points="14,56 36,22 54,56" stroke="rgba(255,82,212,0.45)" stroke-width="0.55" vector-effect="non-scaling-stroke"/>

    <polygon points="42,56 50,28 76,56" fill="url(#mtn-back)"/>
    <polyline class="edge" points="42,56 50,28 76,56" stroke="rgba(255,82,212,0.45)" stroke-width="0.55" vector-effect="non-scaling-stroke"/>

    <polygon points="64,56 82,20 102,56" fill="url(#mtn-back)"/>
    <polyline class="edge" points="64,56 82,20 102,56" stroke="rgba(255,82,212,0.45)" stroke-width="0.55" vector-effect="non-scaling-stroke"/>

    <polygon points="88,56 104,30 124,56" fill="url(#mtn-back)"/>
    <polyline class="edge" points="88,56 104,30 124,56" stroke="rgba(255,82,212,0.45)" stroke-width="0.55" vector-effect="non-scaling-stroke"/>

    <polygon points="112,56 128,24 158,56" fill="url(#mtn-back)"/>
    <polyline class="edge" points="112,56 128,24 158,56" stroke="rgba(255,82,212,0.45)" stroke-width="0.55" vector-effect="non-scaling-stroke"/>

    <polygon points="140,56 166,18 188,56" fill="url(#mtn-back)"/>
    <polyline class="edge" points="140,56 166,18 188,56" stroke="rgba(255,82,212,0.45)" stroke-width="0.55" vector-effect="non-scaling-stroke"/>

    <polygon points="174,56 192,26 218,56" fill="url(#mtn-back)"/>
    <polyline class="edge" points="174,56 192,26 218,56" stroke="rgba(255,82,212,0.45)" stroke-width="0.55" vector-effect="non-scaling-stroke"/>
  </g>

  <g>
    <polygon points="-18,56 12,14 38,56" fill="url(#mtn-mid)"/>
    <polyline class="edge" points="-18,56 12,14 38,56" stroke="#ff52d4" stroke-width="0.75" vector-effect="non-scaling-stroke"/>

    <polygon points="10,56 45,4 74,56" fill="url(#mtn-mid)"/>
    <polyline class="edge" points="10,56 45,4 74,56" stroke="#ff52d4" stroke-width="0.75" vector-effect="non-scaling-stroke"/>

    <polygon points="54,56 78,20 102,56" fill="url(#mtn-mid)"/>
    <polyline class="edge" points="54,56 78,20 102,56" stroke="#ff52d4" stroke-width="0.75" vector-effect="non-scaling-stroke"/>

    <polygon points="94,56 110,8 152,56" fill="url(#mtn-mid)"/>
    <polyline class="edge" points="94,56 110,8 152,56" stroke="#ff52d4" stroke-width="0.75" vector-effect="non-scaling-stroke"/>

    <polygon points="118,56 142,22 162,56" fill="url(#mtn-mid)"/>
    <polyline class="edge" points="118,56 142,22 162,56" stroke="#ff52d4" stroke-width="0.75" vector-effect="non-scaling-stroke"/>

    <polygon points="150,56 170,6 210,56" fill="url(#mtn-mid)"/>
    <polyline class="edge" points="150,56 170,6 210,56" stroke="#ff52d4" stroke-width="0.75" vector-effect="non-scaling-stroke"/>

    <polygon points="178,56 200,16 230,56" fill="url(#mtn-mid)"/>
    <polyline class="edge" points="178,56 200,16 230,56" stroke="#ff52d4" stroke-width="0.75" vector-effect="non-scaling-stroke"/>
  </g>

  <path d="M 0,56 L 0,48 L 12,42 L 26,46 L 40,38 L 56,44 L 70,36 L 84,42 L 100,32 L 116,40 L 130,38 L 146,46 L 162,38 L 176,42 L 190,36 L 200,44 L 200,56 Z" fill="url(#mtn-fore)"/>
</svg>

<!-- CITY — 4 silhouette layers: far mountains → distant skyline → main towers → foreground low-rises -->
<svg class="skyline skyline-city" viewBox="0 0 200 56" preserveAspectRatio="none" aria-hidden="true">
  <defs>
    <linearGradient id="city-mtn" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#7a2eb0"/><stop offset="100%" stop-color="#4a1980"/>
    </linearGradient>
    <linearGradient id="city-back" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#4a1980"/><stop offset="100%" stop-color="#2a0d54"/>
    </linearGradient>
    <linearGradient id="city-mid" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#220a42"/><stop offset="100%" stop-color="#0d041e"/>
    </linearGradient>
    <linearGradient id="city-fore" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#050009"/><stop offset="100%" stop-color="#000000"/>
    </linearGradient>
  </defs>

  <path d="M 0,56 L 0,34 L 12,30 L 26,33 L 40,28 L 54,32 L 68,26 L 82,30 L 96,24 L 110,28 L 124,20 L 138,22 L 150,16 L 158,12 L 164,16 L 172,22 L 184,28 L 196,30 L 200,32 L 200,56 Z" fill="url(#city-mtn)"/>

  <path d="M 0,56
    L 0,32 L 5,32 L 5,28 L 11,28 L 11,30 L 17,30
    L 17,24 L 23,24 L 23,28 L 29,28
    L 29,22 L 35,22 L 35,26 L 41,26
    L 41,30 L 47,30 L 47,28 L 50,28
    L 50,40 L 65,40
    L 65,26 L 71,26 L 71,30 L 77,30
    L 77,22 L 83,22 L 83,26 L 89,26
    L 89,30 L 95,30 L 95,24 L 101,24
    L 101,28 L 107,28 L 107,22 L 113,22
    L 113,26 L 119,26 L 119,30 L 125,30
    L 125,24 L 130,24
    L 130,40 L 170,40
    L 170,28 L 175,28 L 175,22 L 179,22
    L 179,26 L 185,26 L 185,30 L 191,30
    L 191,24 L 197,24 L 197,28 L 200,28
    L 200,56 Z" fill="url(#city-back)"/>
  <g fill="#b58dd9" opacity="0.45">
    <rect x="6.5"  y="30" width="0.4" height="0.8"/>
    <rect x="18"   y="26" width="0.4" height="0.8"/>
    <rect x="24.5" y="26" width="0.4" height="0.8"/>
    <rect x="30.5" y="24" width="0.4" height="0.8"/>
    <rect x="42.5" y="28" width="0.4" height="0.8"/>
    <rect x="48.5" y="29" width="0.4" height="0.8"/>
    <rect x="66.5" y="28" width="0.4" height="0.8"/>
    <rect x="72.5" y="24" width="0.4" height="0.8"/>
    <rect x="78.5" y="24" width="0.4" height="0.8"/>
    <rect x="84.5" y="28" width="0.4" height="0.8"/>
    <rect x="96.5" y="26" width="0.4" height="0.8"/>
    <rect x="108.5" y="24" width="0.4" height="0.8"/>
    <rect x="114.5" y="28" width="0.4" height="0.8"/>
    <rect x="126.5" y="26" width="0.4" height="0.8"/>
    <rect x="174.5" y="24" width="0.4" height="0.8"/>
    <rect x="186.5" y="26" width="0.4" height="0.8"/>
    <rect x="192.5" y="26" width="0.4" height="0.8"/>
  </g>

  <path d="M 0,56
    L 0,38 L 4,38 L 4,30 L 9,30
    L 9,36 L 14,36 L 14,20 L 19,20
    L 19,14 L 21,14 L 21,24 L 27,24
    L 27,56 L 32,56
    L 32,28 L 36,28
    L 36,10 L 38,10 L 38,4 L 39,4 L 39,12 L 42,12
    L 42,22 L 48,22 L 48,28 L 54,28
    L 54,16 L 59,16 L 59,9 L 60.5,9 L 60.5,18 L 65,18
    L 65,12 L 70,12 L 70,22 L 76,22
    L 76,28 L 81,28
    L 81,56 L 86,56
    L 86,8 L 87.5,8 L 87.5,16 L 92,16
    L 92,24 L 97,24 L 97,14 L 102,14
    L 102,26 L 107,26 L 107,20 L 112,20
    L 112,8 L 113.5,8 L 113.5,16 L 118,16
    L 118,28 L 123,28 L 123,18 L 128,18
    L 128,12 L 130,12 L 130,22 L 135,22
    L 135,26 L 140,26 L 140,14 L 145,14
    L 145,6 L 146.5,6 L 146.5,18 L 150,18
    L 150,28 L 156,28
    L 156,56 L 161,56
    L 161,14 L 166,14 L 166,24 L 171,24
    L 171,30 L 176,30 L 176,18 L 181,18
    L 181,10 L 182.5,10 L 182.5,20 L 186,20
    L 186,26 L 191,26
    L 191,56 L 196,56
    L 196,28 L 200,28
    L 200,56 Z" fill="url(#city-mid)"/>
  <g fill="#ffb0e6" opacity="0.7">
    <rect x="5"   y="34" width="0.6" height="1.2"/>
    <rect x="5"   y="32" width="0.6" height="1.2"/>
    <rect x="10"  y="22" width="0.6" height="1.2"/>
    <rect x="15"  y="24" width="0.6" height="1.2"/>
    <rect x="15"  y="28" width="0.6" height="1.2"/>
    <rect x="20"  y="16" width="0.6" height="1.2"/>
    <rect x="22.5" y="20" width="0.6" height="1.2"/>
    <rect x="33"  y="24" width="0.6" height="1.2"/>
    <rect x="33"  y="20" width="0.6" height="1.2"/>
    <rect x="36.5" y="14" width="0.6" height="1.2"/>
    <rect x="40"  y="18" width="0.6" height="1.2"/>
    <rect x="40"  y="14" width="0.6" height="1.2"/>
    <rect x="44"  y="26" width="0.6" height="1.2"/>
    <rect x="49"  y="26" width="0.6" height="1.2"/>
    <rect x="49"  y="22" width="0.6" height="1.2"/>
    <rect x="55"  y="20" width="0.6" height="1.2"/>
    <rect x="55"  y="24" width="0.6" height="1.2"/>
    <rect x="62"  y="14" width="0.6" height="1.2"/>
    <rect x="66.5" y="16" width="0.6" height="1.2"/>
    <rect x="71"  y="14" width="0.6" height="1.2"/>
    <rect x="71"  y="18" width="0.6" height="1.2"/>
    <rect x="77"  y="24" width="0.6" height="1.2"/>
    <rect x="88"  y="12" width="0.6" height="1.2"/>
    <rect x="93.5" y="20" width="0.6" height="1.2"/>
    <rect x="98"  y="18" width="0.6" height="1.2"/>
    <rect x="103.5" y="22" width="0.6" height="1.2"/>
    <rect x="108.5" y="22" width="0.6" height="1.2"/>
    <rect x="115"  y="20" width="0.6" height="1.2"/>
    <rect x="119"  y="24" width="0.6" height="1.2"/>
    <rect x="124"  y="22" width="0.6" height="1.2"/>
    <rect x="129"  y="16" width="0.6" height="1.2"/>
    <rect x="131"  y="20" width="0.6" height="1.2"/>
    <rect x="136"  y="22" width="0.6" height="1.2"/>
    <rect x="141.5" y="18" width="0.6" height="1.2"/>
    <rect x="147"  y="10" width="0.6" height="1.2"/>
    <rect x="151.5" y="22" width="0.6" height="1.2"/>
    <rect x="162"  y="18" width="0.6" height="1.2"/>
    <rect x="167"  y="20" width="0.6" height="1.2"/>
    <rect x="172"  y="28" width="0.6" height="1.2"/>
    <rect x="177.5" y="22" width="0.6" height="1.2"/>
    <rect x="183"  y="14" width="0.6" height="1.2"/>
    <rect x="187.5" y="22" width="0.6" height="1.2"/>
    <rect x="197"  y="22" width="0.6" height="1.2"/>
  </g>

  <path d="M 0,56
    L 0,46 L 8,46
    L 8,42 L 14,42 L 14,38 L 22,38
    L 22,48 L 32,48
    L 32,46 L 33,46 L 33,42 L 36,42 L 36,36 L 38,36 L 38,42 L 41,42 L 41,46 L 42,46
    L 42,40 L 56,40
    L 56,50 L 66,50
    L 66,44 L 78,44
    L 78,36 L 90,36
    L 90,48 L 100,48
    L 100,42 L 107,42 L 107,46 L 114,46
    L 114,38 L 126,38
    L 126,46 L 138,46
    L 138,42 L 150,42
    L 150,38 L 157,38 L 157,44 L 164,44
    L 164,50 L 178,50
    L 178,42 L 188,42
    L 188,46 L 200,46
    L 200,56 Z" fill="url(#city-fore)"/>

  <g fill="url(#city-fore)">
    <rect x="3"   y="42" width="1.6" height="4"/>
    <rect x="2.6" y="41" width="2.4" height="1"/>
    <rect x="82"  y="32" width="2"   height="4"/>
    <rect x="81.6" y="31" width="2.8" height="1"/>
    <rect x="119" y="34" width="1.8" height="4"/>
    <rect x="182" y="38" width="1.6" height="4"/>
    <polygon points="46,40 50,37 54,40"/>
    <polygon points="142,42 146,39 150,42"/>
  </g>
  <g stroke="#0a0218" stroke-width="0.3" fill="none">
    <line x1="86" y1="28" x2="86" y2="32"/>
    <line x1="120" y1="30" x2="120" y2="34"/>
    <line x1="170" y1="34" x2="170" y2="38"/>
  </g>

  <g fill="#ffb88a" opacity="0.6">
    <rect x="2"   y="50" width="0.6" height="1.2"/>
    <rect x="5"   y="48" width="0.6" height="1.2"/>
    <rect x="10"  y="44" width="0.6" height="1.2"/>
    <rect x="16"  y="40" width="0.6" height="1.2"/>
    <rect x="19"  y="44" width="0.6" height="1.2"/>
    <rect x="25"  y="50" width="0.6" height="1.2"/>
    <rect x="28"  y="52" width="0.6" height="1.2"/>
    <rect x="34"  y="44" width="0.6" height="1.2"/>
    <rect x="39"  y="38" width="0.6" height="1.2"/>
    <rect x="44"  y="42" width="0.6" height="1.2"/>
    <rect x="51"  y="46" width="0.6" height="1.2"/>
    <rect x="58"  y="52" width="0.6" height="1.2"/>
    <rect x="63"  y="54" width="0.6" height="1.2"/>
    <rect x="68"  y="46" width="0.6" height="1.2"/>
    <rect x="74"  y="48" width="0.6" height="1.2"/>
    <rect x="80"  y="38" width="0.6" height="1.2"/>
    <rect x="86"  y="42" width="0.6" height="1.2"/>
    <rect x="93"  y="50" width="0.6" height="1.2"/>
    <rect x="97"  y="52" width="0.6" height="1.2"/>
    <rect x="103" y="44" width="0.6" height="1.2"/>
    <rect x="110" y="48" width="0.6" height="1.2"/>
    <rect x="117" y="40" width="0.6" height="1.2"/>
    <rect x="123" y="42" width="0.6" height="1.2"/>
    <rect x="130" y="48" width="0.6" height="1.2"/>
    <rect x="135" y="50" width="0.6" height="1.2"/>
    <rect x="142" y="44" width="0.6" height="1.2"/>
    <rect x="147" y="46" width="0.6" height="1.2"/>
    <rect x="154" y="40" width="0.6" height="1.2"/>
    <rect x="160" y="46" width="0.6" height="1.2"/>
    <rect x="168" y="52" width="0.6" height="1.2"/>
    <rect x="174" y="54" width="0.6" height="1.2"/>
    <rect x="183" y="44" width="0.6" height="1.2"/>
    <rect x="192" y="48" width="0.6" height="1.2"/>
    <rect x="196" y="50" width="0.6" height="1.2"/>
  </g>
</svg>
`;
