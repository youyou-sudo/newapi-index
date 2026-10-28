# magpie Routing page: the "sky" request-path animation

Implementation-ready spec for the animated request path on magpie's **Routing** page, so it can be rebuilt as a
React 19 + SVG component without opening the 5782-line original.

**Line references are exact.** Shorthand used throughout:

| Shorthand | Real path (under D:\Users\xiaoy\Documents\Github\magpie) |
| --- | --- |
| client.js:N | internal/gui/assets/plugins/routing/client.js (5782 lines) |
| routing.css:N | internal/gui/assets/plugins/routing/routing.css (843 lines) |
| trace.go:N | internal/gateway/trace.go (the wire model) |
| routing.go:N | internal/gateway/routing.go (Rest, fail codes) |
| gui-trace.go:N | internal/gui/trace.go (the HTTP envelope) |

Everything below was read from those files. Anything I could not verify is marked **[unverified]**.

---

## 0. Decisive numbers (read this first)

| Thing | Value | Source |
| --- | --- | --- |
| Stage grid | 124px 124px minmax(0,1fr), column-gap 56px, padding 22px 2px | routing.css:9 |
| Stacking | wires (z auto) < nodes (z 1) < sky (z 2) | routing.css:10, 40, 44, 53, 19 |
| Packet radius | 4.5, shrinks to 4 on the successful return leg | client.js:2958, 3033 |
| Agent to hub flight (no try yet) | **620 ms** | client.js:2991 |
| First try, agent to account | **1400 ms** | client.js:3010 |
| Later try, hub to account (reroute) | **900 ms** | client.js:3010 |
| Success return account to agent | **1400 ms** | client.js:3035 |
| Final-error return account to agent | **1350 ms** | client.js:3049 |
| Failed try back to hub | **620 ms** | client.js:3056 |
| Motion easing | e = (1 - cos(pi * k)) / 2 | client.js:3306 |
| Wing flap | 0.42s cubic-bezier(.45,0,.3,1) infinite, far wing -0.03s | routing.css:34-36 |
| Wire flow | rtflow .7s linear infinite on stroke-dasharray 3 5, offset 0 to -8 | routing.css:12, 16 |
| Held packet pulse | rtheld 1.2s ease-in-out infinite (opacity to .45) | routing.css:26-27 |
| Node tick | rttick .4s ease-out, 40% scale(1.04) | routing.css:51-52 |
| Row "new" | rtin .4s ease-out | routing.css:101, 118 |
| Row failure shake | rthit .45s + tag shown, tag removed after 1800 ms | routing.css:100-102, client.js:3041-3043 |
| Live bloom (row dot / step dot) | rtlive 1.8s infinite | routing.css:92-93 |
| Max agents on stage | 4 (newest) | client.js:1285 |
| Max concurrently flying requests | 4 (LIVE) | client.js:3276-3277 |
| Linger | 12000 ms after a request finishes, its agent stays | client.js:1091 |
| Wire re-layout during FLIP | every frame for 520 ms | client.js:1597, 3310 |
| Tail keep | 60 routes | trace.go:25, client.js:3403 |
| Bird fade-out after release | 450 ms (.rt-flier.away) | client.js:2954, routing.css:37-38 |

---

## 1. Source map

| Region | What lives there |
| --- | --- |
| client.js:42-300 | page scaffolding; creates wires SVG, sky SVG, srcs, hub, list; path(), tick() |
| client.js:1091-1101 | LINGER, holds map, holdAll() |
| client.js:1105-1161 | fly(), tip(), via(), until()/wake(), say()/show() |
| client.js:1163-1206 | layout() -- all wire geometry |
| client.js:1234-1263 | seated(), seat(), tried(), tryseat() (row identity + order) |
| client.js:1276-1322 | staged(), hue palette, agentNode() |
| client.js:1367-1388 | wiresTo(), shownRow() |
| client.js:1429-1601 | makeRow(), rebuild() (rows, folds, sub headings, FLIP) |
| client.js:1668-1792 | lightRow() + render(): the lit / live / rest rule |
| client.js:2927-2963 | FLIER markup, bird(), away(), packet() |
| client.js:2969-3086 | play() (the whole packet state machine), home(), stopPlays() |
| client.js:3242-3337 | pose() (per-frame carrier), resume(), frame(), pause(), start() |
| client.js:3373-3454 | poll() -- where new requests start flying |
| client.js:5483-5680 | the tray-panel mini stage (separate, simpler) |
| routing.css:9-118 | the stage, wires, sky, flier, hub, rows, their keyframes |
| routing.css:162-165 | prefers-reduced-motion kill-list |

---

## 2. Visual model: what is on the stage

### 2.1 DOM order (client.js:56-79)

```
div.rt
├── div.rt-top            (what / mode text -- not animated)
├── div.rt-stage          (position: relative, the coordinate space)
│   ├── svg.rt-wires      (all wires; aria-hidden)
│   ├── div.rt-srcs       (one .rt-node.rt-src per agent)
│   ├── div.rt-node.rt-hub(logo + "magpie" + gateway host + routing chip)
│   ├── ol.rt-accts       (account / key rows, folds, group-in-group headings)
│   └── svg.rt-sky        (packets, magpies, and the invisible "via" curves)
├── div.rt-foot, div.rt-log, ...
```

stage.append(wires, srcs, hub, list, sky) -- client.js:79, with the comment "the magpies fly over the
nodes, the wires run under them".

### 2.2 Coordinate space

Both SVGs get viewBox="0 0 W H" where W,H are the **stage's** border-box size, and both are
position:absolute; inset:0 (client.js:1167-1168; routing.css:10, 19). So **all geometry is in stage-local
pixels**, 1:1 with CSS px. The helper

```js
const b = (e) => ({ l, r, t, b, cx, cy })   // client.js:1166, getBoundingClientRect() minus stage origin
```

is the only measurement primitive. overflow: visible on both SVGs (routing.css:10, 19) means overshoot is
allowed but not expected.

### 2.3 Columns

| Grid cell | Element | Derivation |
| --- | --- | --- |
| col 1 (124px) | div.rt-srcs -- one div.rt-node.rt-src per distinct route.agent among the **staged** routes | client.js:1476-1493 |
| col 2 (124px) | div.rt-node.rt-hub -- fixed | client.js:67-73 |
| col 3 (1fr) | ol.rt-accts -- one li per seat, plus li.rt-fold and li.rt-sub | client.js:1498-1575 |

div.rt-srcs is display:grid; gap:10px (routing.css:40); ol.rt-accts is display:grid; gap:7px
(routing.css:53). .rt-srcs.many (set when >1 agent, client.js:1481) tightens node padding to 8px 8px 7px
and shrinks the icon to 20px (routing.css:41-43).

### 2.4 Which routes are staged (client.js:1276-1287)

```
staged() =
  pinned ? [pinned]
  : (day && !replay) ? []
  : routes (matching the purpose filter)
      .filter(r => playing.has(r.id) || (r is that agent's latest && (!r.done || r.time + r.ms > now - 12000)))
  then: union with cur; keep only the <=4 newest distinct agents
```

Consequences for a reimplementation: **the stage never shows more than 4 agents**, a finished request
lingers for exactly LINGER = 12000 ms after it ended, and every *live* request is staged regardless of
that window (playing.has(id)).

### 2.5 Agent node (client.js:1312-1322)

```
div.rt-node.rt-src[style="--agent: <hue>"]
├── span.rt-ic > icon(svg/img)
├── b              -> agent display name
└── small          -> route.model, or "folder, folder" when the agent works in >1 folder at once
```

--agent is set on **both** the node and its wire (client.js:1318-1319). a.sub content: client.js:1489-1492.
Tooltip = agent name / model / folders (1492).

**Hue derivation** (client.js:1295-1306): fixed table for known agents
(claude #d97757, codex #6366f1, gemini #0ea5e9, copilot #a855f7, cursor #14b8a6, opencode #eab308,
crush #ec4899, goose #84cc16, pi #10b981, omp #d946ef, omo #7c3aed, dsh #06b6d4,
commandcode #f97316, mimocode #3b82f6, deveco #3c99cc), else

```js
h = 0; for (c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return SPARE[h % 8];
// SPARE = ["#8b5cf6","#22c55e","#0d9488","#0891b2","#ca8a04","#db2777","#2563eb","#65a30d"]
```

Note the deliberate absence of red (comment at 1292-1294; a test holds it).

### 2.6 Hub node (client.js:67-73)

div.rt-node.rt-hub = <svg class="rt-bird" viewBox="0 0 44 44"><use href="#bird"/></svg> + <b>magpie</b> +
<small> gateway host (scheme stripped, client.js:3456) + <i> routing-mode chip (client.js:1622-1624;
hidden when there is only one candidate, lone, 1618/1623).

### 2.7 Account / key rows (client.js:1429-1449, 1498-1575)

Row identity is the **seat**:

```js
const seat = (x) => x.id + "\u0000" + (x.model || "") + (x.fixed ? ":" + x.fixed : "");  // client.js:1253
```

-- i.e. one row per (account-or-key, model, fixed effort). Row DOM:

```
li[style="--depth: <n>"]
├── i.dot
├── b > span.who, " ", span(plan|provider), code.mdl(model[:fixed]), small.fb("fast"|"fallback")
├── em            (state sentence)
├── div.bar > i   (usage fill width %)
└── span.tag      (status . fail, on a failed try -- appears on .tagged)
```

**Row order inside the column** is seated(r) (client.js:1234-1248): [...r.order, ...(r.left filtered to
heldOut)], sorted by the tuple

```
[ fallback?1:0,
  index of provider/model[:fixed] in group.members  (else members.length),
  (name || provider),
  aside?1:0,
  rankOf(w),           // the provider's own account/key list order, client.js:1211-1219
  who || "",
  id ]
```

with localeCompare for strings. heldOut(w) = !w.held && (w.capped || w.noCredits) (client.js:1233): accounts
at a cap are **drawn but faded** rather than dropped, so the column does not jump.

Depth: --depth = via.length + (folded ? 1 : 0) (client.js:1550); CSS indents 18px per depth
(routing.css:55). Group-in-group headings (li.rt-sub, client.js:1328-1350) and folds li.rt-fold
(client.js:1397-1427) are extra list items between rows; FOLD_AT = 3 keys/accounts of one provider+model+effort
fold into one row, and a group that routes to LONG = 6 or more collapses to its heading (client.js:1072,
1525, 1558).

### 2.8 Narrow layout

When the .rt box is <=560px (class max560, set by a width observer -- see client.js:264-274 pattern),
the grid becomes 1fr 1fr with the accounts full-width underneath (routing.css:180-184). The wire builder
has an explicit branch for this (see 3.2/3.3).

---

## 3. Wire geometry

Wires are plain <path> elements created by path() (client.js:298) and appended to the one
svg.rt-wires. (For readability the snippets below build the `d` string with concatenation; the original uses
template literals. Values are verbatim.) They carry **no class by default**; the classes live/lit/rest are toggled later by
render() (4.1). d is recomputed wholesale by layout() (client.js:1163-1206).

### 3.1 Agent to hub (client.js:1170-1173)

```js
const s = b(agent.node), h = b(hub);
const mx = (s.r + h.l) / 2;
if (h.l > s.r)  // wide layout: hub is to the right of the agent column
  d = "M" + s.r + " " + s.cy + " C" + mx + " " + s.cy + " " + mx + " " + h.cy + " " + h.l + " " + h.cy;
else            // narrow layout: hub is below
  d = "M" + s.cx + " " + s.b + " L" + h.cx + " " + h.t;
```

A single symmetric S-curve in the wide case: both control points sit at the horizontal midpoint, so the
wire leaves and enters **horizontally**, on each box's centre line.

### 3.2 Hub to account row (the normal, wide case) (client.js:1174-1182)

```js
const fromHub = (a) => {
  if (a.l > h.r) {                       // account column is to the right of the hub
    const mx = (h.r + a.l) / 2;
    return "M" + h.r + " " + h.cy + " C" + mx + " " + h.cy + " " + mx + " " + a.cy + " " + a.l + " " + a.cy;
  }
  ... lane form below
};
```

Same S-curve doctrine: exits the hub horizontally, enters the row at its left edge, centred.

### 3.3 Hub to account row (the "lane down its left" form) (client.js:1179-1182)

Used when the accounts sit **under** magpie (narrow layout, and also whenever a row's left edge is not to the
right of the hub):

```js
const low = b(srcs).b;                       // bottom of the agents column
const x   = a.l - 12;                        // lane x: 12px left of the row
const y   = Math.max(h.b, low - 8);          // lane top: below the hub, and below the agents
d = "M" + h.cx + " " + h.b
  + " L" + h.cx + " " + y
  + " C" + h.cx + " " + (y + 22) + " " + x + " " + (y + 2) + " " + x + " " + (y + 24)
  + " L" + x + " " + (a.cy - 10)
  + " Q" + x + " " + a.cy + " " + a.l + " " + a.cy;
```

So: straight down out of the hub's bottom, a 90-degree-ish cubic elbow (vertical to vertical, 24px of travel)
into a lane 12px left of the rows, straight down the lane, then a quadratic Q corner into the row's left edge.

### 3.4 Group-in-group heading to child (client.js:1185-1188)

```js
const p = b(heading.li), x = p.l + 9;
d = "M" + p.l + " " + p.cy + " Q" + x + " " + p.cy + " " + x + " " + (p.cy + 9)
  + " L" + x + " " + (a.cy - 9) + " Q" + x + " " + a.cy + " " + a.l + " " + a.cy;
```

i.e. a lane 9px inside the heading's left edge, hanging down to the child row.

### 3.5 Which wires make up "the way to a row" -- wiresTo(row) (client.js:1367-1379)

```js
function wiresTo(row) {
  const out = [];
  const via = row.w.via || [];                                  // outer->inner group ids
  for (let d = 1; d <= via.length; d++) out.push(subs.get(via.slice(0, d).join(">")).wire);
  const f = row.fold && folds.get(row.fold);
  if (f?.open) out.push(f.wire);                                // only when the fold is open
  return [...out, row.wire];
}
```

Every leg in the returned array is an **ordered** path that starts at the hub side and ends at the row.
This is the array the packet flies down and back up.

shownRow(id) (client.js:1383-1388) redirects a seat whose row is folded/shut to the heading the reader
actually sees; play() uses shownRow, so packets target the fold, not an invisible row.

### 3.6 Tips: where a flight meets a wire -- tip(path, atEnd, back) (client.js:1114-1122)

Returns a **thunk** (geometry is re-read every frame/leg):

```js
L = p.isConnected && p.getTotalLength?.() || 0;  if (!L) return null;
a = p.getPointAtLength(atEnd ? L : 0);
b = p.getPointAtLength(atEnd ? max(0, L - 2) : min(L, 2));
tx = atEnd ? a.x - b.x : b.x - a.x;  ty = atEnd ? a.y - b.y : b.y - a.y;
if (back) { tx = -tx; ty = -ty; }
n = hypot(tx, ty) || 1;
return { x: a.x, y: a.y, tx: tx / n, ty: ty / n };   // point + unit tangent
```

The 2px sample is what makes the tangent stable on a curve. back flips it (used when the flight arrives
travelling *towards* the hub, i.e. it must leave the hub side).

### 3.7 via(): the arc through the hub between two wires (client.js:1127-1150)

Every via is a real, invisible <path class="via"> appended to sky (routing.css:25 sets
stroke: none), so the same getPointAtLength machinery can walk it. It is rebuilt every frame by
pose() while in use, and removed when the flight ends.

```js
const a = from(), b = to();        // tips
if (!a || !b) { removeAttribute("d"); return; }
dx = b.x - a.x; dy = b.y - a.y; dist = hypot(dx, dy);
if (dist < 4) {                    // same point: loop round inside the hub
  const hb = hub.getBoundingClientRect();
  const k = Math.min(hb.width, hb.height) * .42, m = k * .6;
  const nx = a.ty,  ny = -a.tx;    // left normal of the incoming tangent
  c1 = [a.x + a.tx * k - nx * m, a.y + a.ty * k - ny * m];
  c2 = [b.x - b.tx * k + nx * m, b.y - b.ty * k + ny * m];
} else {                           // gentle arc
  const k = dist * .38, l = Math.min(16, dist * .12);
  const nx = dy / dist, ny = -dx / dist;
  c1 = [a.x + a.tx * k + nx * l, a.y + a.ty * k + ny * l];
  c2 = [b.x - b.tx * k + nx * l, b.y - b.ty * k + ny * l];
}
d = "M" + a.x + " " + a.y + " C" + c1 + " " + c2 + " " + b.x + " " + b.y;
```

Reading: control points sit 0.38 x distance along each tip's own tangent, pushed sideways by
min(16px, 0.12 x distance). The packet therefore **carries its incoming heading through magpie and
leaves on the next wire's heading**, which is what makes a reroute look like the bird banked around inside the
hub rather than snapping. The dist < 4 branch is the "it came in and went back out the same side" case: a
loop of radius ~0.42 x min(hubW, hubH) around the hub.

### 3.8 When geometry is recomputed

layout() runs on: every rebuild() (client.js:1600); a ResizeObserver on the stage
(client.js:5760); and **every animation frame while performance.now() < flipUntil** (client.js:3310),
where flipUntil = performance.now() + 520 is set by the FLIP animation in rebuild()
(client.js:1584-1598). That is how wires stay glued to rows while rows are moving.

FLIP itself: measure each row's old top before the DOM move (client.js:1505-1506), then after inserting
set transition:none; transform:translateY(dy), force reflow, clear both, and let
transition: transform .5s cubic-bezier(.2,.8,.2,1) (routing.css:54) animate. Skipped entirely under reduced
motion (client.js:1589).

---

## 4. Per-element visual states

### 4.1 Wire classes (routing.css:11-16, set by client.js:1668-1673)

| Class | Stroke | Behaviour | Set when |
| --- | --- | --- | --- |
| (none) | var(--line), 1.5px | idle, transition: opacity .3s | default |
| .live | var(--agent), dash 3 5, rtflow .7s linear infinite (offset 0 to -8) | **flowing**: a packet is on it / a try is with it now | lightRow(..., on, now) with now === true |
| .lit | var(--agent), solid | **the path this request took, over**: static, no motion | on && !now |
| .rest | dash 2 6, opacity .45 | the account/key is resting or unlisted | row.wire.classList.toggle("rest", resting or w.unlisted) (client.js:1748) |

```js
function lightRow(li, wire, on, now) {     // client.js:1668
  li.classList.toggle("on", on);
  li.classList.toggle("now", on && now);
  wire.classList.toggle("live", on && now);
  wire.classList.toggle("lit",  on && !now);
}
```

**The decisive rule (#2386, quoted in the source at client.js:1737-1740):** only a request *in flight*
flows. A finished answer stays lit but **still**, "or a finished request reads as one still being called".

Applied in render() (client.js:1741-1748):

```js
const flying = !resting && (trying.has(id) || onWire.has(id));  // onWire = a packet is between rows
const on     = flying || (!resting && answered.has(id));
lightRow(row.li, row.wire, on, flying);
if (on) row.wire.style.setProperty("--agent", hueOf(r.agent));  // hue follows the request, not the row
```

trying = seats of tries with !tr.done (client.js:1681); onWire = seats in flying.values()
(client.js:1683). Agent wires only ever get **.live** (never .lit): for (const [id,a] of agents)
a.wire.classList.toggle("live", busy.has(id)) (client.js:1791), where busy is both sets.

### 4.2 The packet (client.js:2956-2963, routing.css:22-27)

```js
const dot = document.createElementNS(NS, "circle");
dot.setAttribute("r", 4.5);
dot.setAttribute("class", "pkt");
dot.setAttribute("visibility", "hidden");   // until a flight puts it somewhere
dot.style.setProperty("--agent", hueOf(r.agent));   // client.js:2982
```

| State | Fill | Stroke | Extras |
| --- | --- | --- | --- |
| .pkt (outbound request) | var(--agent) | none | drop-shadow(0 0 3px var(--agent)); r=4.5 |
| .pkt.back (answer) | var(--card) | var(--agent), 2.25px | ringed, r=4 |
| .pkt.back.err (error to the agent) | var(--agent) | var(--red) | failure |
| .pkt.held | (unchanged) | (unchanged) | rtheld 1.2s ease-in-out infinite, opacity .45 at 50% |

The dot is positioned by cx/cy attributes (client.js:3256-3258), and its visibility is removed on
the first pose. It is removed from the DOM at the end of play() (client.js:3068).

### 4.3 The magpie / flier (client.js:2931-2955, routing.css:28-39)

Markup (single string constant FLIER, client.js:2931-2940), inserted **into sky**:

```
<g class="rt-flier req|res">
  <g class="rt-lift">
    <g transform="scale(1.2) translate(-6.5 3.2)">
      <path class="wing far" .../>  <path class="tail" .../>
      <ellipse class="body" .../>   <ellipse class="belly" .../>
      <circle class="body" .../>    <path class="body" .../>   (head + beak)
      <g class="wing near"><path .../><path class="bar" .../></g>
    </g>
  </g>
</g>
```

The bird is drawn **facing right**, and the dot it carries sits at the tip of its beak -- hence the
translate(-6.5 3.2) baked into the markup: the flier's origin is placed *at the dot's position* by pose().

| Animation | Where | Values |
| --- | --- | --- |
| wing beat | routing.css:34-36 | .42s cubic-bezier(.45,0,.3,1) infinite; 0%,100% scaleY(1) to 55% scaleY(-.62) skewX(-8deg); transform-box: fill-box; transform-origin: 50% 100% (shoulder) |
| far wing offset | routing.css:35 | animation-delay: -.03s (and opacity: .45) |
| appear | routing.css:37, 39 | .rt-lift animation rtcome .3s ease-out: from translate(-6px,-10px) scale(.85) opacity 0 |
| leave | routing.css:37-38 | .rt-flier.away .rt-lift { transform: translate(14px,-16px) scale(.8); opacity: 0 } on a .45s cubic-bezier(.3,0,.2,1) transition |
| colour | routing.css:28-32 | color: var(--fg); body/tail/wings currentColor; belly var(--card); wing bar is a card-coloured stroke |

Two bird kinds exist only as class names: req and res (client.js:2984, 3034). **[unverified]** -- no CSS
rule distinguishes .rt-flier.req from .rt-flier.res; visually they are identical, the difference is which
dot they carry.

bird() returns **null** when still() or !shown() (client.js:2943) -- the dot then flies alone.
away(b) adds .away and removes the node after **450 ms** (client.js:2951-2955).

### 4.4 Hub and agent ticks (client.js:300, routing.css:51-52)

```js
const tick = (e) => { e.classList.remove("tick"); void e.offsetWidth; e.classList.add("tick"); };
```

The forced reflow is what lets the same class re-trigger a one-shot animation. rttick .4s ease-out,
40% { transform: scale(1.04) }.

Fired at (client.js:2989, 2993, 3007, 3038, 3052):
- agent node: when a request **leaves** it, and when an answer **arrives** back;
- hub: when the request reaches it (first entry, and again on each hand-off to the next candidate).

### 4.5 Row classes (routing.css:88-104, client.js:1735-1748)

| Class | Meaning | Visual |
| --- | --- | --- |
| .on | answers or answered the shown request | border var(--fg); em, bar fill, dot go --fg |
| .now | a try with it is in flight | .dot gets rtlive 1.8s infinite (expanding halo) |
| .rest | resting after a failure, or unlisted | dashed border, children at opacity .5, em red |
| .left | its vendor does not list the model, so never asked | dotted border, opacity .45 |
| .low | >=90% used and not the routing criterion | em goes --fg-2 |
| .new | row just appeared | rtin .4s ease-out |
| .hit | a try just failed here | rthit .45s shake: 20% -5px, 40% +4px, 60% -2px, 80% +1px |
| .tagged | its .tag is shown | tag fades/slides in .25s; auto-removed after **1800 ms** (client.js:3043) |

.tag text on a failure is exactly <status> . <failWord(fail)> (client.js:3042), e.g. "429 . rate limited".

---

## 5. Packet / flier motion -- the play() state machine

### 5.1 Entry points

- A **new request** arrives in poll() (client.js:3373-3454): every id present in the payload but not in
  routes is "fresh" (3399-3401); then
  ```js
  const go = !pinned && !rp && !day && shown() ? fresh.filter(matchesPurpose) : [];
  for (const id of go) playing.set(id, gen);
  if (go.length) sync();          // one rebuild for all of them (#308)
  for (const id of go) play(id, true);
  ```
  (client.js:3442-3445). Note synced=true skips the internal sync().
- **Coming back into sight**: resume() replays only requests still !done, at most LIVE = 4, newest
  ids last (client.js:3276-3286).
- **Replay**: step() calls play(g.r.id) for each plan entry whose start has been reached
  (client.js:3162), against ghost routes.

### 5.2 The machine (client.js:2969-3072)

```js
async function play(id, synced) {
  const routes = src(); let r = routes.get(id); const g = gen;
  playing.set(id, g); cur = r;
  if (!synced) sync();
  say(affWhy(r,true) || ruleWhy(r,true) || firstWhy(r));   // caption
  /* ... */ renderAll();
  const A = agents.get(r.agent);
  const dot = packet(); dot.style.setProperty("--agent", hueOf(r.agent));
  let carrier = bird("req"), from = null, back = null;
  const rt = () => routes.get(id) || { ...r, done: true, tries: r.tries.map(x => ({...x, done:true})) };
  try {
    tick(A.node);
    if (!r.tries.length) {                       // routing has not picked yet
      await fly(dot, carrier, [{ p: A.wire }], 620);
      from = tip(A.wire, true);                  // at the hub end of the agent's wire
      tick(hub);
    }
    for (let i = 0; g === gen; ) {
      r = rt(); if (!routes.has(id)) break;
      if (i >= r.tries.length) { if (r.done) break; await until(...); continue; }
      const row = shownRow(tryseat(r, r.tries[i]));  if (!row) { i++; continue; }
      flying.set(dot, { id: tryseat(r, r.tries[i]), agent: r.agent });
      if (!carrier) carrier = bird("req");
      if (from) tick(hub);
      const ws  = wiresTo(row);
      const out = [via(from || tip(A.wire, true), tip(ws[0], false)), ...ws.map(p => ({ p }))];
      await fly(dot, carrier, from ? out : [{ p: A.wire }, ...out], from ? 900 : 1400);
      if (g !== gen) break;
      away(carrier); carrier = null;             // let go at the account
      dot.classList.add("held"); holds.set(dot, row); holdAll();
      await until(() => g !== gen || rt().tries[i].done);      // wait while it answers
      holds.delete(dot);
      const tr = r.tries[i]; dot.classList.remove("held");
      if (tryOk(tr)) {
        await until(() => g !== gen || rt().done);             // wait for the whole route (tokens)
        dot.classList.add("back"); dot.setAttribute("r", 4);
        back = bird("res");
        await fly(dot, back, home(row, A), 1400);
        away(back); tick(A.node); break;
      }
      row.li.classList.remove("hit"); void row.li.offsetWidth; row.li.classList.add("hit","tagged");
      row.tg.textContent = `${tr.status} · ${failWord(tr.fail)}`;
      setTimeout(() => row.li.classList.remove("tagged"), 1800);
      dot.classList.add("back","err"); back = bird("res");
      if (!tr.rest && (!tr.again || tr.gone)) {                // that was the answer
        await fly(dot, back, home(row, A), 1350); away(back); tick(A.node); break;
      }
      await fly(dot, back, [...ws].reverse().map(p => ({ p, rev: true })), 620);  // back to hub
      dot.classList.remove("back","err");
      from = tip(ws[0], false, true);            // leaves the hub on that wire's reversed heading
      i++;
    }
  } finally {
    away(carrier); away(back); flying.delete(dot); holds.delete(dot); dot.remove();
    if (playing.get(id) === g) playing.delete(id); renderAll();
  }
}
```

home() (client.js:3075-3078):

```js
const home = (row, A) => {
  const ws = wiresTo(row);
  return [...[...ws].reverse().map(p => ({ p, rev: true })),
          via(tip(ws[0], false, true), tip(A.wire, true, true)),
          { p: A.wire, rev: true }];
};
```

i.e. **back up the same wires**, then a via curve through the hub, then **backwards down the agent's wire**.

### 5.3 Leg protocol

A **leg** is { p: SVGPathElement, rev?: boolean, j?: () => void }.

- rev: true means "walk this path end to start" (getPointAtLength(L - d), client.js:3252).
- j is a re-evaluator for a via leg; pose() calls every l.j() first each frame (client.js:3243),
  so an arc follows both wires as they move (e.g. during a resize).
- fly() removes the via paths in a .finally() (for (const l of legs) if (l.j) l.p.remove(),
  client.js:1110) -- a via never outlives its flight.
- If a leg is not laid out (getTotalLength() 0 / not connected) it is **skipped**, and the param walks on
  (client.js:3250).

### 5.4 The per-frame carrier -- pose(tr, e) (client.js:3242-3269)

```js
lens  = legs.map(p => p.getTotalLength())
total = sum(lens)
point(d):
  d = clamp(d, 0, total); i = 0;
  while (i < lens.length-1 && (d > lens[i] || !lens[i])) { d -= lens[i]; i++; }
  return legs[i].p.getPointAtLength(legs[i].rev ? lens[i] - d : d);

d = e * total; pt = point(d);
dot.cx = pt.x; dot.cy = pt.y; dot.removeAttribute("visibility");

// the bird
p0 = point(d - 3); p1 = point(d + 3);
vx = p1.x - p0.x; vy = p1.y - p0.y;
if (|vx| + |vy| < .01) { vx = bird._vx ?? (legs[0].rev ? -1 : 1); vy = 0; }
bird._vx = vx;
aim = clamp(atan2(vy, |vx|) * 180/PI, -24, +24);     // degrees
bird._a = (bird._a === undefined || bird._flip !== (vx < 0))
        ? aim
        : bird._a + (aim - bird._a) * .12;           // 12% lerp per frame
bird._flip = vx < 0;
bird.setAttribute("transform",
  "translate(" + pt.x.toFixed(1) + " " + pt.y.toFixed(1) + ") scale(" + (bird._flip ? -1 : 1) + " 1) rotate(" + bird._a.toFixed(1) + ")");
```

Semantics:
- **One parameter for the whole flight.** The flight is a polyline of paths; e in [0,1] maps linearly to
  total arclength. Consequence: a flight through three short wires spends proportionally less time on them.
- **Bank** is clamped to +-24 degrees, uses atan2(vy, |vx|) so it is sign-correct in both directions, is
  *snapped* on a direction change and otherwise **lerped 12% per frame** (so it settles in about 8 frames at
  60fps).
- **Turn-around** is a horizontal mirror (scale(-1 1)), not a rotation -- the bird never flies upside down.
- The dot gets no transform; it is drawn at the arclength point, which is the bird's beak by construction.

### 5.5 The rAF loop (client.js:3294-3330)

```js
function frame(ts) {
  ticking = 0;
  const vis = shown();
  if (vis && (!seen || ts - lastFrame > 1000)) resume();   // stale after a gap / first sight
  seen = vis; lastFrame = ts;
  if (vis) {
    const now_ = trips; trips = [];
    for (const tr of now_) {
      if (tr.g !== gen) { tr.res(); continue; }            // cancelled: end the flight
      const k = tr.ms ? Math.min(1, Math.max(0, (ts - tr.t0) / tr.ms)) : 1;
      pose(tr, (1 - Math.cos(Math.PI * k)) / 2);           // eased in and out
      if (k >= 1) tr.res(); else trips.push(tr);
    }
    if (ts < flipUntil) layout();
    if (capQ.length && ts - capAt > (capLo && !capQ[0].lo ? 500 : 1700)) show(capQ.shift());
  } else pause();
  if (vis) ticking = requestAnimationFrame(frame);
}
```

- **One** rAF loop drives every flight (trips is a flat array). Nothing is scheduled per packet.
- fly() (client.js:1105-1110) pushes a trip and resolves a promise on completion, which is what makes
  play() readable as await-sequenced phases.
- tr.ms is **0 when reduced motion is on** (client.js:1107), so k = 1 on the first frame: the dot
  teleports and the phase completes immediately.

### 5.6 Cancellation -- generation counter

gen (client.js:1092) is bumped by stopPlays() (client.js:3082-3086), which also clears flying,
holds, playing and removes every .pkt and .rt-flier from sky. Each play() captured g = gen
at entry and checks g === gen after every await and inside every until() predicate; the finally
block always cleans up. Called from pause(), resume(), seek(), endReplay().

until(f) / wake() (client.js:1151-1152) are a predicate-waiter list, woken by the poll and by the
replay step -- **not** polled per frame.

---

## 6. Data to animation mapping

### 6.1 Wire model (authoritative field list)

Route (trace.go:28-132), only what the animation reads:

| Field | JSON | Use in the animation |
| --- | --- | --- |
| Seq int64 | seq | trace cursor; client resets on a lower seq (client.js:3395) |
| ID int64 | id | identity, ordering, freshness (!routes.has(id)) |
| Time | time | linger window start; replay clock |
| Agent | agent | picks the source node + hue |
| Model | model | agent node's subtitle |
| Provider | provider | header when there is no group |
| Group | group | members, subs, via, routing -> row order, sub headings |
| Order | order | **the rows that exist** and their column order |
| Left | left | extra rows, drawn only if heldOut |
| Tries | tries | **the flight plan**: one hop per try |
| Done | done | gates the last leg home; linger start |
| Status, Error | status, error | header/log only |
| Millis | ms | linger end = time + ms |
| TTFT, FirstText, Flow | ttft, firstText, flow | speed text only, **not** motion |

Weighed (trace.go:215-289) per row: id, provider, name, icon, who, kind (account or key or provider),
model, fixed, fast, fallback, via (group path), routing, known, used, rank, aside,
rest ({why,status,until,by,key,model}, routing.go:391-410), unlisted, held, capped, noCredits, sunk.

Try (trace.go:292 onward): id, model, fixed, start, **done**, status, ms, ttft, fail,
rest, again, gone, earlier, replan, patience.

fail codes are the short strings from routing.go:184-234: credit, quota, rate, other, auth,
canceled, foreign, floor, update, verify, refused, shape, prompt, effort, proxy,
overflow, slow, loop, restricted.

### 6.2 What drives which visual

| Input | Visual consequence |
| --- | --- |
| new id in /api/gateway/trace | play() starts -> packet created; agent node ticks |
| tries.length === 0 at play start | shorter first flight (620 ms) agent to hub, then wait at the hub |
| each Try index | one hop hub to account; via curve from the previous wire's tip |
| Try.done === false | dot sits at the account (.held, pulsing), row .now, wire .live, agent wire .live |
| Try.done && status < 400 && !fail (tryOk, client.js:440) | route waits for done, then .back dot (ringed, r=4) flies home |
| Try.done && !tryOk | row shake + tag status . fail; err dot flies home **unless** it will retry |
| Try.rest set, or Try.again set and !gone | dot returns only to the hub (620 ms) and the next try departs from there |
| Route.done | ends the wait before the success return; ends the play if no try is left |
| Weighed.rest.until > now | row .rest (dashed, faded, red state text), wire .rest |
| Weighed.unlisted | row .left, wire .rest |
| Weighed.capped / noCredits | row drawn, faded, "held" (client.js:1233) |
| agent | node + hue (--agent on node, wire, packet, lit wire) |
| Order[].fallback | fallback pill on the row; row sorted after the primary |
| Fixed | row label model:effort; seat identity |

### 6.3 In-flight vs finished

Nothing is derived from wall-clock timing of the request. The animation is **event-driven**: the *waits* are
predicates on the trace (until(() => rt().tries[i].done), until(() => rt().done)). Therefore:

- A request that answers in 80 ms: outbound 1400 ms, a barely-perceptible hold, return 1400 ms.
- A request that answers in 90 s: the dot sits at the account pulsing for 90 s.
- If the trace lags, the flight lags. The 1400/900/620/1350 ms are **fixed** and independent of ms/ttft.

The **only** time-derived visual rule is LINGER (2.4) and the resting check at(rest.until) > now.

---

## 7. State transitions

| Event | What happens |
| --- | --- |
| **New request** | poll() finds an unknown id -> playing.set, sync(), play(id, true). The stage rebuild happens **once** for the whole batch (client.js:3444, "#308"). Rows get .new (rtin .4s) if a prior layout existed and motion is allowed (client.js:1514). |
| **Routing hasn't picked yet** | tries empty -> 620 ms hop to the hub, tick(hub), then wait on until(tries.length > i or done) (client.js:2990-3001). |
| **Try starts** | hop out (1400 ms first, 900 ms later), flying.set(dot, {id, agent}) -> that row's wire becomes .live, row .now; the bird is released at arrival (away, 450 ms fade). |
| **Try fails -> reroute** | row .hit shake + .tagged for 1800 ms; err dot returns to the hub in 620 ms; the *next* hop departs from the hub with from = tip(ws[0], false, true), and the outbound via reuses the incoming heading (the hub "hands it on"). |
| **Try fails -> final answer** | err dot flies the full way home (1350 ms), agent node ticks; no reroute. Condition: !tr.rest && (!tr.again or tr.gone) (client.js:3048). |
| **Held at account** | .pkt.held pulses at 1.2 s; holds map re-poses the dot at e = 1 of its wires after every layout() (holdAll, client.js:1098-1100) so a window resize does not strand it. |
| **Success** | wait for Route.done first (tokens are counted by then), then ringed dot .back (r=4) + a fresh res bird, 1400 ms home, agent node ticks. |
| **Resting account** | row .rest, wire .rest (dashed 2 6 at .45 opacity), state text <failWord(rest.why)> . <time left>; cleared as soon as rest.until passes or that seat answers (client.js:1704). |
| **Old request deleted** | client keeps 60 (routes.keys().sort().slice(0, -60), client.js:3403); a deleted mid-flight id makes rt() fall back to {done:true, all tries done}, so the machine exits cleanly at the next check. |
| **Replay** | play() runs unchanged against ghost routes; step() (client.js:3148-3170) inserts a ghost when its start time is reached, gaps > GAP = 1800 ms collapsed, LEAD = 500 ms pre-roll; speed 1x to 2x to 4x to 8x. |
| **Page hidden / resumed** | frame() stops entirely (pause(): ends replays, resolves trips, wakes waiters). On return, resume() calls stopPlays() then replays **only** still-!done requests (max 4). |
| **Pinned / filtered** | staged() returns only the pinned route; go is empty so nothing new plays (client.js:3442). |

---

## 8. Reduced motion and performance

### 8.1 Reduced motion

```js
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;   // client.js:46
const shown = () => !$("#view-routing").hidden && !document.hidden;           // client.js:47
```

Four independent effects:

1. bird() returns **null** -> **no birds at all** (client.js:2943). The dot still flies.
2. fly() sets ms = 0 -> every hop completes on its first frame (client.js:1107). The sequence of
   states is preserved, the travel is not.
3. FLIP row movement is skipped (if (!dy || still()) continue, client.js:1589) and .new is not added
   (client.js:1514).
4. CSS kill-list (routing.css:162-165): li.now .dot, path.live, .pkt.held, li.new, li.hit,
   .rt-hub.tick, .rt-src.tick, .rt-cap.in, .rt-steps li.wait::before -> animation: none, plus
   li { transition: none }. Wire dashes and colours remain (static), so the *information* (path taken,
   resting, error) survives.

Note there is **no** transition: none blanket -- .rt-lift's .45s transition is not disabled by this
block **[unverified whether that is intentional]**.

### 8.2 Performance rules

| Rule | Implementation |
| --- | --- |
| one rAF for everything | trips array + single frame() (client.js:3294) |
| no rAF when not visible | loop is not rescheduled when !shown() (client.js:3313) and start() is driven by MutationObserver on the view's hidden + visibilitychange + focus (client.js:3333-3335) |
| batch DOM redraws | renderAll() collapses to one rAF: if (!drawing) drawing = requestAnimationFrame(drawAll) (client.js:2916-2922) |
| cap concurrency | LIVE = 4 on resume (client.js:3276); new requests are not capped, but they arrive at poll cadence |
| cap stage size | 4 agents (client.js:1285); rows only for order/left of staged routes |
| cap geometry work | layout() on rebuild + resize + only 520 ms after a FLIP |
| avoid layout thrash | patch() reuses identical rows (client.js:2904-2911) because per-second countdown re-renders otherwise made WebKit scroll the page |
| skip when not laid out | tip() returns null, via drops its d, pose skips zero-length legs |
| don't fight the poll | caption queue is throttled to one swap per 500 ms (soft) / 1700 ms (hard) (client.js:3311) |

---

## 9. TypeScript sketch for the normalized input

Nothing here maps 1:1 to magpie's Go structs; it is the *minimal* shape the animation needs. Keep times as
**epoch ms numbers** (the client converts with new Date(s).getTime(), client.js:307).

```ts
export type FailCode =
  | 'credit' | 'quota' | 'rate' | 'other' | 'auth' | 'canceled' | 'foreign' | 'floor'
  | 'update' | 'verify' | 'refused' | 'shape' | 'prompt' | 'effort' | 'proxy'
  | 'overflow' | 'slow' | 'loop' | 'restricted';

export interface Rest {
  why: FailCode;          // Rest.Why (routing.go:391)
  status: number;
  until: number;          // epoch ms
  by?: string;            // "credit" | "retry-after" | "resets" | "window" | "quota" | ...
  model?: string;         // one model resting, not the whole account
}

export interface Weighed {           // one seat = one row
  id: string;
  kind: 'account' | 'key' | 'provider';
  provider: string;
  name: string;                      // the provider's display name
  who?: string;                      // the account / key label
  model: string;
  fixed?: string;                    // pinned effort -> part of the seat identity
  fast?: boolean;
  fallback?: boolean;
  icon?: string;
  via?: string[];                    // groups-in-group path, outermost first
  routing?: string;                  // '', 'order', 'rotate', 'usage'
  known?: boolean;
  used?: number;                     // 0..100 share
  rank?: number;                     // provider's own list order
  aside?: boolean;
  unlisted?: boolean;                // never asked -> row.left, wire.rest
  held?: boolean;                    // gateway key may not use it
  capped?: number;                   // 0 = not capped, else percent
  noCredits?: boolean;
  sunk?: number;                     // epoch ms, rate-limited to the back
  rest?: Rest;
}

export interface Try {
  id: string;                        // matches a Weighed.id (seat via id+model+fixed)
  model?: string;
  fixed?: string;
  start: number;                     // epoch ms
  done: boolean;                     // <- the main animation gate
  status: number;
  ms?: number;
  ttft?: number;
  fail?: FailCode;
  rest?: Rest;
  again?: number;                    // ms to wait before a retry
  gone?: boolean;                    // cancelled while waiting to retry
  earlier?: boolean;
}

export interface RouteView {
  id: number;
  seq: number;
  time: number;                      // epoch ms
  agent: string;
  model: string;
  provider: string;
  group?: {
    id: string; name: string; routing: string;
    members: string[];               // "provider/model[:effort]"
    subs?: { id: string; name: string; routing?: string; in: string }[];
    via?: string[];
  };
  order: Weighed[];                  // rows that exist, in the order routing weighed them
  left?: Weighed[];                  // extra candidates (drawn only when capped/noCredits)
  tries: Try[];                      // the flight plan: one hop per entry
  done: boolean;
  status?: number;
  ms?: number;                       // linger end = time + ms
}

export interface AgentView {
  id: string;
  name: string;
  icon?: string;
  hue?: string;                      // omit to derive with hueOf() (client.js:1301)
}

/** The one prop a <RoutingSky/> needs. now is the clock used for resting + linger. */
export interface SkyInput {
  now: number;
  routes: RouteView[];               // latest version of each route, any order
  agents: AgentView[];
  gatewayHost?: string;              // hub subtitle
  routingMode?: string;              // hub chip
  pinnedId?: number | null;          // show only this route
  reducedMotion?: boolean;           // else read the media query
  maxAgents?: number;                // default 4
  maxFlying?: number;                // default 4
}

/** Emitted by the component so a host can drive captions / the log. */
export interface SkyEvents {
  onPhase?(routeId: number, phase: 'depart' | 'arrive' | 'held' | 'answer' | 'fail' | 'done'): void;
  onPick?(routeId: number): void;
  onTickNode?(node: 'hub' | 'agent:' + string): void;
}
```

### 9.1 Suggested component split

```tsx
<RoutingSky input={SkyInput} events={SkyEvents} />          // owns the rAF, the packet list
  <svg class="rt-wires">   {wires.map(w => <path d={w.d} class={w.cls} style={{"--agent": w.hue}}/>)} </svg>
  <div class="rt-srcs">    {agents.map(a => <AgentNode .../>)} </div>
  <div class="rt-node rt-hub">...</div>
  <ol class="rt-accts">    {rows.map(r => <AccountRow .../>)} </ol>
  <svg class="rt-sky">     {vias} {packets} {birds} </svg>
```

Because getPointAtLength is needed for leg walking, wires and vias must be **real mounted <path>
elements** -- do not try to compute the motion in JS only from the d string unless you also implement a
path-length sampler.

### 9.2 Implementation checklist (order matters)

1. **Geometry module** -- pure functions agentWire(rectAgent, rectHub, narrow), rowWire(rectRow, rectHub,
   low), viaD(tipA, tipB, hubBox); port section 3 verbatim.
2. **Layout pass** -- measure stage + each node, write viewBox, write each d. Re-run on resize, on rebuild,
   and for 520 ms after any order change.
3. **Row model** -- seat key, seated() sort, depth, folds/subs.
4. **Scheduler** -- one rAF; trips array; k = ms ? clamp((t - t0)/ms) : 1; e = (1 - cos(pi k))/2.
5. **Player** -- async generator or state machine mirroring 5.2; every wait is a data predicate, never a timer.
6. **Styles** -- port routing.css:9-52 and 88-104 verbatim; they *are* the animation.
7. **Reduced motion** -- the 4 switches of 8.1.

### 9.3 Gotchas

- **tick() needs a forced reflow** between remove and add, or the animation will not replay.
- **--agent must be set on the wire, not inherited from the row**, because a row can be lit by another
  agent's request (client.js:1747).
- **The bird's origin is the dot.** Do not centre a bird on its own body; translate it to the arclength point
  and the beak lands on the packet.
- **via paths must live in the sky SVG and be removed** when the flight ends; leaking them silently grows
  the DOM by one path per hop.
- **Held dots must be re-posed after any re-layout**, or a resize leaves them mid-air (client.js:1093-1100
  documents the regression, #1859).
- **A finished answer must not flow.** The whole point of the #2386 split is that .lit is static.
- **The trace envelope is incremental**: /api/gateway/trace?after=<seq>&wait=1 (client.js:3376) returns
  {seq, now, mine, totals, routes} (gui-trace.go:19-24; gateway/trace.go:466-468). mine === false
  means another process serves the gateway -- magpie shows an offline message instead (client.js:3383-3393).

---

## 10. Things I could not verify

- No CSS or JS distinguishes .rt-flier.req from .rt-flier.res in style -- both render identically.
- routing.css does not disable .rt-lift's .45s transition under reduced motion (8.1).
- The tray-panel mini stage (client.js:5483-5680: pFly, pTick, pSeat, pLayout) is a **second, simpler**
  implementation with its own geometry (ps-* classes, same cubic easing, ps-dot) and is not covered in
  detail here; if the new UI needs the collapsed-panel variant, treat it as a separate port.
- The exact poll interval is not visible in client.js (the loop is await fetch(...) with wait=1
  long-polling); cadence is effectively server-driven.
