export default function Botanical() {
  return <svg className="botanical" viewBox="0 0 460 420" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="leaf" x1="150" y1="60" x2="330" y2="290" gradientUnits="userSpaceOnUse"><stop stopColor="#477b50"/><stop offset="1" stopColor="#173e32"/></linearGradient>
      <linearGradient id="light-leaf" x1="280" y1="70" x2="410" y2="250" gradientUnits="userSpaceOnUse"><stop stopColor="#8ca365"/><stop offset="1" stopColor="#406c43"/></linearGradient>
      <linearGradient id="pot" x1="220" y1="290" x2="340" y2="410" gradientUnits="userSpaceOnUse"><stop stopColor="#e8bb90"/><stop offset="1" stopColor="#c88762"/></linearGradient>
      <radialGradient id="halo"><stop stopColor="#f5f5d6"/><stop offset="1" stopColor="#e2ebd3" stopOpacity="0"/></radialGradient>
    </defs>
    <circle cx="288" cy="188" r="184" fill="url(#halo)"/>
    <circle cx="290" cy="210" r="145" stroke="#b8c79e" strokeOpacity=".4"/>
    <circle cx="290" cy="210" r="181" stroke="#b8c79e" strokeOpacity=".3"/>
    <ellipse cx="287" cy="396" rx="115" ry="14" fill="#78906c" opacity=".17"/>
    <g stroke="#416343" strokeWidth="4" strokeLinecap="round"><path d="M280 326C271 250 243 175 187 122"/><path d="M284 326C290 232 318 185 360 130"/><path d="M276 328C251 245 205 227 156 215"/><path d="M288 327C320 270 361 252 394 248"/><path d="M282 325C268 211 287 140 278 85"/></g>
    <path d="M254 207C190 221 128 194 121 130c-4-36 10-65 35-83 3 28 14 39 35 43-4-23-2-37 8-53 38 15 60 49 64 76-20-1-36-9-46-18 0 21 14 35 47 39 9 31 7 52-10 73Z" fill="url(#leaf)"/>
    <path d="M245 202C224 149 194 107 156 64" stroke="#a2b77a" strokeOpacity=".6" strokeWidth="2"/>
    <path d="m177 128 34 6m-10 30 28-3m-81-51 38-3" stroke="#93ad72" strokeOpacity=".45" strokeWidth="1.5"/>
    <path d="M291 185C270 145 259 119 274 84c12-29 31-40 59-47 2 33-3 65-17 89-15 24-19 38-25 59Z" fill="#668650"/>
    <path d="m291 173 33-119" stroke="#c0ca8f" strokeOpacity=".6" strokeWidth="1.5"/>
    <path d="M302 215C282 163 297 110 338 88c25-13 58-15 83-3-18 13-24 25-21 43 14-9 26-12 43-7-3 30-16 52-41 65-4-17-3-28 3-39-19 7-26 21-24 48-28 20-54 28-79 20Z" fill="url(#light-leaf)"/>
    <path d="M310 206C332 160 361 120 403 92" stroke="#c8d3a3" strokeOpacity=".65" strokeWidth="2"/>
    <path d="M257 281C214 298 161 283 142 256c-11-16-18-38-15-62 18 4 35 10 46 21l-1-25c39 9 64 35 85 91Z" fill="#52764b"/>
    <path d="m147 216 104 60" stroke="#abc18a" strokeWidth="1.5" strokeOpacity=".7"/>
    <path d="M306 299C319 258 342 236 371 229c25-6 49 0 68 15-22 34-62 63-133 55Z" fill="#7a9658"/>
    <path d="m315 294 106-47" stroke="#d0d9ad" strokeOpacity=".7" strokeWidth="1.5"/>
    <path d="M223 316h118l-16 65c-2 10-17 17-43 17s-41-7-43-17l-16-65Z" fill="url(#pot)"/>
    <path d="M229 326h106" stroke="#a36f50" strokeOpacity=".35" strokeWidth="3"/>
    <path d="M238 336l11 43m-1-43 10 47" stroke="#f6d4b0" strokeOpacity=".45" strokeWidth="2"/>
    <ellipse cx="282" cy="315" rx="61" ry="14" fill="#deb086"/>
    <ellipse cx="282" cy="313" rx="49" ry="8" fill="#6c543a"/>
    <path d="M273 313v-19m13 19 3-18m-9 16-6-20" stroke="#416343" strokeWidth="3" strokeLinecap="round"/>
    <g fill="#fcfff1"><path d="m99 237 3 8 8 3-8 3-3 8-3-8-8-3 8-3 3-8Z"/><path d="m383 43 2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6Z"/></g>
    <circle cx="154" cy="320" r="4" fill="#91a775" opacity=".6"/>
    <circle cx="401" cy="314" r="3" fill="#91a775" opacity=".6"/>
  </svg>;
}
