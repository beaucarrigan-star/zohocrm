/* processes-guide.js: interactive Contract and Billing walkthroughs for the Processes widget (Guide section in the rail).
   Each module renders into a shadow root so its styles cannot clash with the engine; engine colour tokens pass through.
   Sample screens only: nothing here reads or writes Zoho. Progress ticks are kept in this browser (localStorage). */
(function () {
  'use strict';
  var RM = window.RecModules, X;
  var CSS = ":host{display:block;--surface-2:var(--surface2);--fg:var(--ink);--crit:var(--bad);--crit-soft:var(--bad-soft);--accent-ink:var(--on-accent);--font-body:var(--font);--font-mono:var(--mono)}\n.pgroot{color:var(--fg);font-family:var(--font-body);font-size:14px;line-height:1.5;display:flex;flex-direction:column;gap:16px}\n\n/* Layout: tab switch for the two pipelines, a numbered step rail on the left, and one step panel on the right\n   with an interactive mock of the real screen. Graphite neutrals with a cobalt accent, matching CRM theme v3. */\n*{box-sizing:border-box}\nh2 { font-size: 20px; line-height: 1.25; margin: 0; font-weight: 600; text-wrap: balance; }\nh3 { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 0 0 8px; font-weight: 600; }\np { margin: 0; }\nbutton { font: inherit; color: inherit; cursor: pointer; }\n:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }\n\n\n.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }\n.fact { background: var(--surface); padding: 10px 14px; min-width: 0; }\n.fact b { display: block; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 600; }\n\n.main { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 20px; align-items: start; }\n.rail { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 12px; position: sticky; top: 12px; min-width: 0; }\n.bar { height: 6px; background: var(--surface-2); border-radius: 3px; overflow: hidden; margin: 6px 0 12px; }\n.bar i { display: block; height: 100%; background: var(--accent); transition: width .25s; }\n.rail-top { font-size: 12px; color: var(--muted); display: flex; justify-content: space-between; gap: 8px; }\n.rail-top button { background: none; border: 0; color: var(--accent); padding: 0; font-size: 12px; text-decoration: underline; }\n.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }\n.step { width: 100%; display: flex; gap: 10px; align-items: center; text-align: left; background: none; border: 0; border-radius: 5px; padding: 8px; }\n.step:hover { background: var(--surface-2); }\n.step[aria-current=\"step\"] { background: var(--accent-soft); }\n.num { flex: none; width: 24px; height: 24px; border-radius: 50%; border: 1.5px solid var(--line); display: grid; place-items: center; font-size: 12px; font-weight: 600; font-family: var(--font-mono); background: var(--surface); }\n.step[aria-current=\"step\"] .num { border-color: var(--accent); color: var(--accent); }\n.step.done .num { background: var(--good); border-color: var(--good); color: var(--bg); }\n.step span.t { font-size: 14px; line-height: 1.3; min-width: 0; }\n\n.panel { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 24px; display: flex; flex-direction: column; gap: 22px; min-width: 0; }\n.kicker { font-family: var(--font-mono); font-size: 12px; color: var(--accent); }\n.lead { color: var(--muted); max-width: 65ch; margin-top: 6px; }\n.two { display: grid; grid-template-columns: minmax(0, 1fr); gap: 22px; }\nul.plain, ol.plain { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; max-width: 65ch; }\n.callout { border-radius: 6px; padding: 10px 14px; font-size: 14px; background: var(--warn-soft); color: var(--fg); border: 1px solid var(--line); }\n.callout b { color: var(--warn); }\n.trouble { display: flex; flex-direction: column; gap: 8px; }\n.trouble details { border: 1px solid var(--line); border-radius: 6px; padding: 8px 12px; background: var(--surface); }\n.trouble summary { cursor: pointer; font-weight: 500; }\n.trouble details p { margin-top: 6px; color: var(--muted); max-width: 65ch; }\n.nav { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; border-top: 1px solid var(--line); padding-top: 16px; }\n.btn { border: 1px solid var(--line); background: var(--surface); padding: 8px 14px; border-radius: 6px; font-weight: 500; }\n.btn:hover:not(:disabled) { background: var(--surface-2); }\n.btn.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }\n.btn.primary:hover:not(:disabled) { background: var(--accent); filter: brightness(1.08); }\n.btn:disabled { opacity: .45; cursor: not-allowed; }\n.btn.sm { padding: 4px 10px; font-size: 13px; }\n\n/* mock screens */\n.mock { border: 1px solid var(--line); border-radius: 6px; background: var(--bg); padding: 14px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }\n.mock-head { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; align-items: center; font-weight: 600; }\n.mock-note { font-size: 12px; color: var(--muted); }\n.crumbs { display: flex; gap: 6px; flex-wrap: wrap; font-size: 12px; font-family: var(--font-mono); }\n.crumb { padding: 2px 8px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); }\n.crumb.on { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }\n.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }\n.seg button { border: 0; background: var(--surface); padding: 6px 14px; }\n.seg button[aria-pressed=\"true\"] { background: var(--accent); color: var(--accent-ink); }\n.row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }\n.list { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }\n.list > * { padding: 8px 12px; border-top: 1px solid var(--line); min-width: 0; }\n.list > *:first-child { border-top: 0; }\n.opt { display: flex; gap: 8px; align-items: center; text-align: left; background: none; border-left: 0; border-right: 0; border-bottom: 0; width: 100%; }\n.opt[aria-pressed=\"true\"] { background: var(--accent-soft); font-weight: 500; }\n.opt .dot { width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid var(--muted); flex: none; }\n.opt[aria-pressed=\"true\"] .dot { background: var(--accent); border-color: var(--accent); }\n.drop { border: 1.5px dashed var(--line); border-radius: 6px; padding: 18px; text-align: center; color: var(--muted); background: var(--surface); }\n.chip { display: inline-block; font-size: 12px; padding: 1px 8px; border-radius: 10px; font-weight: 500; white-space: nowrap; }\n.chip.good { background: var(--good-soft); color: var(--good); }\n.chip.warn { background: var(--warn-soft); color: var(--warn); }\n.chip.crit { background: var(--crit-soft); color: var(--crit); }\n.chip.info { background: var(--accent-soft); color: var(--accent); }\n.chip.mute { background: var(--surface-2); color: var(--muted); }\n.file { display: flex; justify-content: space-between; gap: 10px; align-items: center; }\n.file span:first-child { min-width: 0; overflow-wrap: anywhere; }\n.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }\n.tile { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 8px 12px; }\n.tile b { display: block; font-size: 20px; font-variant-numeric: tabular-nums; font-family: var(--font-mono); font-weight: 500; }\n.tile span { font-size: 12px; color: var(--muted); }\n.prog { height: 8px; background: var(--surface-2); border-radius: 4px; overflow: hidden; }\n.prog i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .4s; }\n.banner { padding: 8px 12px; border-radius: 6px; font-weight: 500; font-size: 14px; }\n.banner.good { background: var(--good-soft); color: var(--good); }\n.banner.crit { background: var(--crit-soft); color: var(--crit); }\n.item { display: flex; gap: 10px; justify-content: space-between; align-items: center; flex-wrap: wrap; }\n.item .txt { min-width: 0; flex: 1 1 220px; }\n.item .txt small { display: block; color: var(--muted); font-size: 12px; }\n.acts { display: flex; gap: 6px; flex-wrap: wrap; }\n.tbl-wrap { overflow-x: auto; }\ntable { border-collapse: collapse; width: 100%; font-size: 14px; }\nth, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }\nth { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 600; white-space: nowrap; }\ntd.n { font-variant-numeric: tabular-nums; font-family: var(--font-mono); }\n.cellbtn { background: var(--accent-soft); border: 1px solid transparent; border-radius: 4px; padding: 1px 10px; color: var(--accent); font-family: var(--font-mono); }\n.cellbtn[aria-pressed=\"true\"] { background: var(--accent); color: var(--accent-ink); }\n.track { display: flex; gap: 6px; flex-wrap: wrap; align-items: stretch; }\n.node { border: 1px solid var(--line); background: var(--surface); border-radius: 6px; padding: 8px 12px; min-width: 110px; text-align: left; }\n.node[aria-pressed=\"true\"] { border-color: var(--accent); background: var(--accent-soft); }\n.node small { display: block; color: var(--muted); font-size: 12px; }\n.arrow { align-self: center; color: var(--muted); }\n.kv { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 14px; font-size: 14px; }\n.kv dt { color: var(--muted); }\n.kv dd { margin: 0; }\nselect, input[type=text] { font: inherit; color: var(--fg); background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; max-width: 100%; }\n.tree { font-family: var(--font-mono); font-size: 13px; line-height: 1.6; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 10px 14px; overflow-x: auto; white-space: pre; }\n.results { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 20px; display: flex; flex-direction: column; gap: 12px; }\n.statusline { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 13px; color: var(--muted); }\n@media (max-width: 800px) {\n  .main { grid-template-columns: minmax(0, 1fr); }\n  .rail { position: static; }\n  .steps { flex-direction: row; overflow-x: auto; gap: 4px; padding-bottom: 4px; }\n  .step { width: auto; flex: none; }\n  .step span.t { display: none; }\n  .step[aria-current=\"step\"] span.t { display: inline; }\n  .panel { padding: 16px; }\n}\n@media (prefers-reduced-motion: reduce) { .bar i, .prog i { transition: none; } }\n";
  var STATE = { contract: { idx: { contract: 0 } }, billing: { idx: { billing: 0 } } };
  function mountGuide(sh, KEY, state) {
  var SKEY = 'process-guide-done-v1';
  var cur = KEY;
  var idx = state.idx;
  var done = { contract: {}, billing: {} };
  var timers = [];
  try { var s = JSON.parse(localStorage.getItem(SKEY)); if (s && s.contract && s.billing) done = s; } catch (e) {}
  function save() { try { localStorage.setItem(SKEY, JSON.stringify(done)); } catch (e) {} }
  function clearTimers() { timers.forEach(function (t) { clearInterval(t); clearTimeout(t); }); timers = []; }
  function $(id) { return sh.getElementById(id); }
  function q(el, sel) { return el.querySelector(sel); }
  function qa(el, sel) { return Array.prototype.slice.call(el.querySelectorAll(sel)); }

  /* ---------- demos: each returns { html, bind(el) } ---------- */
  var demos = {};

  demos.c1 = function () {
    var party = 'Customer', pick = null;
    var lists = {
      Customer: ['Milwaukee County Pretrial'],
      Vendor: ['Allied', 'SCRAM', 'SuperCom', 'Buddi']
    };
    var looks = {
      Customer: 'Looks for term, extensions, notice, spare clause and rates.',
      Vendor: 'Looks for rate lines, tiers, spare and service terms.'
    };
    return {
      html: '<div class="mock-head"><span>Contract Ingest</span><span class="mock-note">Example screen</span></div>' +
        '<div class="crumbs"><span class="crumb on">1 Add files</span><span class="crumb">2 Read files</span><span class="crumb">3 Review</span><span class="crumb">4 Hand off</span></div>' +
        '<div><div class="mock-note" style="margin-bottom:4px">Who is the other party?</div><div class="seg" id="seg"></div></div>' +
        '<div class="mock-note" id="looks"></div>' +
        '<div><div class="mock-note" style="margin-bottom:4px">Choose the contract</div><div class="list" id="clist"></div></div>' +
        '<div class="mock-note" id="pickmsg"></div>',
      bind: function (el) {
        function draw() {
          q(el, '#seg').innerHTML = ['Customer', 'Vendor'].map(function (p) {
            return '<button type="button" data-p="' + p + '" aria-pressed="' + (p === party) + '">' + p + '</button>';
          }).join('');
          q(el, '#looks').textContent = looks[party];
          q(el, '#clist').innerHTML = lists[party].map(function (c) {
            return '<button type="button" class="opt" data-c="' + c + '" aria-pressed="' + (c === pick) + '"><span class="dot"></span>' + c + '</button>';
          }).join('');
          q(el, '#pickmsg').textContent = pick ? 'Selected: ' + pick + '. Next, add the files.' : 'Pick a contract to continue.';
          qa(el, '[data-p]').forEach(function (b) { b.onclick = function () { party = b.dataset.p; pick = null; draw(); }; });
          qa(el, '[data-c]').forEach(function (b) { b.onclick = function () { pick = b.dataset.c; draw(); }; });
        }
        draw();
      }
    };
  };

  demos.c2 = function () {
    var files = ['Master agreement.pdf', 'Addendum 24.pdf', 'Rate schedule.xlsx', 'Signed cover page.pdf'];
    var added = false;
    return {
      html: '<div class="mock-head"><span>Files</span><span class="mock-note">Example screen</span></div>' +
        '<div class="drop" id="drop">Drop the packet here, or press Choose files</div>' +
        '<div class="row"><button class="btn sm" id="addbtn" type="button">Add example packet</button><span class="mock-note" id="addmsg"></span></div>' +
        '<div class="list" id="flist" hidden></div>',
      bind: function (el) {
        q(el, '#addbtn').onclick = function () {
          added = !added;
          q(el, '#addbtn').textContent = added ? 'Remove example packet' : 'Add example packet';
          q(el, '#flist').hidden = !added;
          q(el, '#drop').textContent = added ? 'Packet added: 4 files' : 'Drop the packet here, or press Choose files';
          q(el, '#addmsg').textContent = added ? 'The files are attached to the contract. Nothing else has changed yet.' : '';
          q(el, '#flist').innerHTML = files.map(function (f) { return '<div class="file"><span>' + f + '</span><span class="chip mute">Attached</span></div>'; }).join('');
        };
      }
    };
  };

  demos.c3 = function () {
    var files = [['Master agreement.pdf', 'Parsed', 'good'], ['Addendum 24.pdf', 'Parsed', 'good'], ['Rate schedule.xlsx', 'Parsed', 'good'], ['Signed cover page.pdf', 'No text layer', 'warn']];
    return {
      html: '<div class="mock-head"><span>Read the files</span><span class="mock-note">Example screen</span></div>' +
        '<div class="row"><button class="btn primary sm" id="run" type="button">Read the files</button><span class="mock-note" id="st">Ready.</span></div>' +
        '<div class="prog"><i id="pb"></i></div>' +
        '<div class="list" id="fl"></div>' +
        '<div id="out"></div>',
      bind: function (el) {
        function resetList() {
          q(el, '#fl').innerHTML = files.map(function (f, i) { return '<div class="file"><span>' + f[0] + '</span><span class="chip mute" id="ch' + i + '">Waiting</span></div>'; }).join('');
        }
        resetList();
        q(el, '#run').onclick = function () {
          clearTimers(); resetList(); q(el, '#out').innerHTML = ''; q(el, '#pb').style.width = '0';
          q(el, '#run').disabled = true; q(el, '#st').textContent = 'Reading. Checking every 5 seconds.';
          var i = 0;
          var t = setInterval(function () {
            if (i < files.length) {
              var c = q(el, '#ch' + i); c.className = 'chip ' + files[i][2]; c.textContent = files[i][1];
              i++; q(el, '#pb').style.width = (i / files.length * 100) + '%';
            } else {
              clearInterval(t);
              q(el, '#st').textContent = 'Read finished.';
              q(el, '#run').disabled = false; q(el, '#run').textContent = 'Read again';
              q(el, '#out').innerHTML = '<div class="tiles"><div class="tile"><b>1</b><span>Terms</span></div><div class="tile"><b>4</b><span>Rate lines</span></div><div class="tile"><b>3</b><span>Clauses</span></div><div class="tile"><b>3 of 4</b><span>Documents read</span></div></div>' +
                '<p class="mock-note" style="margin-top:8px">Run summary: Read 4 files. 4 rate lines and 3 clauses proposed. One file needs OCR before it can be read.</p>';
            }
          }, 700);
          timers.push(t);
        };
      }
    };
  };

  demos.c4 = function () {
    var items = [
      ['Rate line 1 of 4', 'Rate schedule.xlsx, sheet 1'], ['Rate line 2 of 4', 'Rate schedule.xlsx, sheet 1'],
      ['Rate line 3 of 4', 'Rate schedule.xlsx, sheet 1'], ['Rate line 4 of 4', 'Addendum 24.pdf'],
      ['Clause: Term and extensions', 'Master agreement.pdf'], ['Clause: Notice', 'Master agreement.pdf'], ['Clause: Spare units', 'Addendum 24.pdf']
    ];
    var state = items.map(function () { return 'Proposed'; });
    return {
      html: '<div class="mock-head"><span>Contract Review</span><span class="chip warn" id="pend"></span></div>' +
        '<div class="list" id="rv"></div>' +
        '<div class="mock-note">Each real row shows its citation and the source sentence. Example rows here show only the source file.</div>',
      bind: function (el) {
        function draw() {
          q(el, '#rv').innerHTML = items.map(function (it, i) {
            var s = state[i], cls = s === 'Proposed' ? 'mute' : (s === 'Rejected' ? 'crit' : 'good');
            return '<div class="item"><div class="txt">' + it[0] + '<small>' + it[1] + '</small></div>' +
              '<span class="chip ' + cls + '">' + s + '</span>' +
              '<div class="acts"><button class="btn sm" data-i="' + i + '" data-a="Confirmed" type="button">Confirm</button>' +
              '<button class="btn sm" data-i="' + i + '" data-a="Edited" type="button">Edit</button>' +
              '<button class="btn sm" data-i="' + i + '" data-a="Rejected" type="button">Reject</button></div></div>';
          }).join('');
          var p = state.filter(function (s) { return s === 'Proposed'; }).length;
          q(el, '#pend').textContent = p ? p + ' still pending' : 'Nothing pending';
          q(el, '#pend').className = 'chip ' + (p ? 'warn' : 'good');
          qa(el, '[data-a]').forEach(function (b) { b.onclick = function () { state[+b.dataset.i] = b.dataset.a; draw(); }; });
        }
        draw();
      }
    };
  };

  demos.c5 = function () {
    return {
      html: '<div class="mock-head"><span>Contract Review</span><span class="mock-note">Example screen</span></div>' +
        '<label class="row"><input type="checkbox" id="rev"> Every rate line and clause has been confirmed, edited or rejected</label>' +
        '<div class="row"><button class="btn primary" id="ver" type="button" disabled>Verify</button><span class="mock-note" id="vh">Verify turns on once nothing is pending.</span></div>' +
        '<div id="vout"></div>',
      bind: function (el) {
        q(el, '#rev').onchange = function () {
          q(el, '#ver').disabled = !this.checked;
          q(el, '#vh').textContent = this.checked ? 'Ready to verify.' : 'Verify turns on once nothing is pending.';
          if (!this.checked) q(el, '#vout').innerHTML = '';
        };
        q(el, '#ver').onclick = function () {
          var d = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
          q(el, '#vout').innerHTML = '<dl class="kv"><dt>Ingest status</dt><dd><span class="chip good">Ingested</span></dd><dt>Last Verified</dt><dd>' + d + '</dd><dt>Next</dt><dd>The vendor-cost margin check runs on this contract.</dd></dl>';
        };
      }
    };
  };

  demos.b1 = function () {
    var vendors = ['Allied', 'SCRAM', 'SuperCom', 'Buddi', 'Drug Testing'];
    return {
      html: '<div class="mock-head"><span>Vendor zip</span><span class="mock-note">Example layout</span></div>' +
        '<label class="row">Vendor <select id="vend"></select></label>' +
        '<div class="tree" id="tree"></div>' +
        '<p class="mock-note">One zip per vendor per month. The exact file names depend on what each vendor system exports.</p>',
      bind: function (el) {
        q(el, '#vend').innerHTML = vendors.map(function (v) { return '<option>' + v + '</option>'; }).join('');
        function draw() {
          var v = q(el, '#vend').value.replace(/\s/g, '-');
          q(el, '#tree').textContent = v + '-October-2026.zip\n  invoice(s)\n  daily assigned-device files   (one per day)\n  daily spare-device files      (one per day)';
        }
        q(el, '#vend').onchange = draw; draw();
      }
    };
  };

  demos.b2 = function () {
    return {
      html: '<div class="mock-head"><span>Billing run</span><span class="mock-note">Example screen</span></div>' +
        '<dl class="kv" style="align-items:center">' +
        '<dt>1. Month</dt><dd><select id="mo"><option>September 2026</option><option selected>October 2026</option></select></dd>' +
        '<dt>1. Vendor</dt><dd><select id="uv"><option>Allied</option><option>SCRAM</option><option>SuperCom</option><option>Buddi</option><option>Drug Testing</option></select></dd>' +
        '<dt>2. Vendor zip</dt><dd><button class="btn sm" id="att" type="button">Choose zip</button> <span class="mock-note" id="am">None chosen</span></dd></dl>' +
        '<div class="row"><button class="btn primary" id="go2" type="button" disabled>Create month and attach</button><span class="chip info" id="stc2" hidden>Open</span></div>' +
        '<div class="mock-note" id="m2">Choose a zip to continue.</div>',
      bind: function (el) {
        var has = false;
        function msg() { if (!has) q(el, '#m2').textContent = 'Choose a zip to continue.'; }
        q(el, '#att').onclick = function () {
          has = !has;
          q(el, '#am').textContent = has ? q(el, '#uv').value + ' zip chosen' : 'None chosen';
          q(el, '#att').textContent = has ? 'Remove zip' : 'Choose zip';
          q(el, '#go2').disabled = !has; q(el, '#stc2').hidden = true;
          q(el, '#m2').textContent = has ? 'Ready.' : 'Choose a zip to continue.';
        };
        q(el, '#go2').onclick = function () {
          q(el, '#stc2').hidden = false;
          q(el, '#m2').textContent = 'Created Billing Period for ' + q(el, '#mo').value + ' and attached the ' + q(el, '#uv').value + ' zip. Next, Reconcile.';
        };
        q(el, '#mo').onchange = q(el, '#uv').onchange = msg;
      }
    };
  };

  demos.b3 = function () {
    return {
      html: '<div class="mock-head"><span>Billing Period record: October 2026</span><span class="mock-note">Example record</span></div>' +
        '<div class="row"><button class="btn primary" id="rec" type="button">Reconcile</button><span class="chip info" id="stc">Open</span></div>' +
        '<dl class="kv"><dt>Last Run Status</dt><dd id="lrs">Not run yet</dd><dt>Last Run At</dt><dd id="lra">Not run yet</dd></dl>' +
        '<p class="mock-note" id="m3">In the real record this runs the check against the attached zip.</p>',
      bind: function (el) {
        q(el, '#rec').onclick = function () {
          clearTimers();
          q(el, '#rec').disabled = true;
          q(el, '#stc').className = 'chip warn'; q(el, '#stc').textContent = 'Reconciling';
          q(el, '#m3').textContent = 'The check is running. Wait for Last Run Status to fill in.';
          var t = setTimeout(function () {
            q(el, '#lrs').innerHTML = '<span class="chip good">Complete</span>';
            q(el, '#lra').textContent = new Date().toLocaleString();
            q(el, '#m3').textContent = 'The run wrote its status and time. Next, confirm the counts.';
            q(el, '#rec').disabled = false; q(el, '#rec').textContent = 'Run again';
          }, 1800);
          timers.push(t);
        };
      }
    };
  };

  demos.b4 = function () {
    var mode = 'ok';
    return {
      html: '<div class="mock-head"><span>Billing Findings: October 2026</span><span class="mock-note">Example screen</span></div>' +
        '<div class="seg" id="bseg"></div>' +
        '<div id="bbanner"></div><div id="bnote" class="mock-note"></div>',
      bind: function (el) {
        function draw() {
          q(el, '#bseg').innerHTML = [['ok', 'Counts match'], ['bad', 'Counts differ']].map(function (m) {
            return '<button type="button" data-m="' + m[0] + '" aria-pressed="' + (mode === m[0]) + '">' + m[1] + '</button>';
          }).join('');
          if (mode === 'ok') {
            q(el, '#bbanner').innerHTML = '<div class="banner good">Counts match the Billing Period: 216 findings.</div>';
            q(el, '#bnote').textContent = 'Safe to start reviewing.';
          } else {
            q(el, '#bbanner').innerHTML = '<div class="banner crit">Period says 216 findings, loaded 212.</div>';
            q(el, '#bnote').textContent = 'Stop here. Do not review this month yet, and tell Beau.';
          }
          qa(el, '[data-m]').forEach(function (b) { b.onclick = function () { mode = b.dataset.m; draw(); }; });
        }
        draw();
      }
    };
  };

  demos.b5 = function () {
    var cols = ['Duplicate', 'Enrollment', 'Month-over-month', 'Rate & math', 'Spare units', 'Tie-out'];
    var vals = [14, 22, 31, 40, 18, 26];
    var sel = null;
    return {
      html: '<div class="mock-head"><span>Findings by vendor and type</span><span class="mock-note">Example numbers</span></div>' +
        '<div class="tbl-wrap"><table><thead><tr><th>Vendor</th>' + cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead>' +
        '<tbody><tr><td>Allied</td>' + vals.map(function (v, i) { return '<td><button class="cellbtn" type="button" data-i="' + i + '" aria-pressed="false">' + v + '</button></td>'; }).join('') + '</tr></tbody></table></div>' +
        '<div id="fl5" class="mock-note">Click a count to list those findings.</div>',
      bind: function (el) {
        qa(el, '[data-i]').forEach(function (b) {
          b.onclick = function () {
            sel = +b.dataset.i;
            qa(el, '[data-i]').forEach(function (x) { x.setAttribute('aria-pressed', String(+x.dataset.i === sel)); });
            var rows = [['CRITICAL', 'J.H. . 34576006', '$73.20'], ['HIGH', 'W.G. . 34510412', '$0.00'], ['MEDIUM', 'R.T. . 34502218', '$12.50']];
            q(el, '#fl5').className = '';
            q(el, '#fl5').innerHTML = '<div class="mock-note" style="margin-bottom:6px">' + vals[sel] + ' Allied findings of type ' + cols[sel] + '. Showing 3 example rows.</div>' +
              '<div class="list">' + rows.map(function (r) {
                var c = r[0] === 'CRITICAL' ? 'crit' : (r[0] === 'HIGH' ? 'warn' : 'mute');
                return '<div class="item"><div class="txt">' + r[1] + '<small>Participant: initials and device ID</small></div><span class="chip ' + c + '">' + r[0] + '</span><span class="n" style="font-family:var(--font-mono)">' + r[2] + '</span></div>';
              }).join('') + '</div><div class="mock-note" style="margin-top:6px">Click a row in the real screen for its description and recommended action.</div>';
          };
        });
      }
    };
  };

  demos.b6 = function () {
    var kinds = {
      Overbilled: ['crit', 'The vendor charged more than we expect. Carries dollars. Decide it and write a Decision note.'],
      Unverified: ['warn', 'We could not confirm the charge from the files. Carries dollars. Decide it and write a Decision note.'],
      Latent: ['mute', 'A $0 item. Information only, so there is no money to decide.']
    };
    var sel = 'Overbilled';
    return {
      html: '<div class="mock-head"><span>A finding record</span><span class="mock-note">Example screen</span></div>' +
        '<div class="row" id="kseg"></div><div class="banner" id="kmsg" style="background:var(--surface);border:1px solid var(--line)"></div>' +
        '<div class="mock-note">On the real record, set the status and write your Decision note. Only the money findings need one.</div>',
      bind: function (el) {
        function draw() {
          q(el, '#kseg').innerHTML = Object.keys(kinds).map(function (k) {
            return '<button type="button" class="btn sm" data-k="' + k + '" aria-pressed="' + (k === sel) + '" style="' + (k === sel ? 'background:var(--accent);color:var(--accent-ink);border-color:var(--accent)' : '') + '">' + k + '</button>';
          }).join('');
          q(el, '#kmsg').textContent = kinds[sel][1];
          qa(el, '[data-k]').forEach(function (b) { b.onclick = function () { sel = b.dataset.k; draw(); }; });
        }
        draw();
      }
    };
  };

  demos.b7 = function () {
    var nodes = [
      ['Open', 'Created, no check run yet.'],
      ['Reconciling', 'The check is running.'],
      ['In Review', 'Findings are loaded and you are deciding them.'],
      ['Reconciled', 'Decisions are in. Recommended Pay shows what to pay the vendor.'],
      ['Needs Attention', 'The month ended here instead of Reconciled. Open it and read why.'],
      ['Frozen', 'The month ended here instead of Reconciled.']
    ];
    var sel = 2;
    return {
      html: '<div class="mock-head"><span>Month status</span><span class="mock-note">Click a status</span></div>' +
        '<div class="track" id="trk"></div><div class="banner" id="tmsg" style="background:var(--surface);border:1px solid var(--line)"></div>',
      bind: function (el) {
        function draw() {
          var h = '';
          nodes.forEach(function (n, i) {
            if (i === 4) h += '<span class="arrow" aria-hidden="true">or</span>';
            else if (i > 0) h += '<span class="arrow" aria-hidden="true">&rarr;</span>';
            h += '<button type="button" class="node" data-n="' + i + '" aria-pressed="' + (i === sel) + '">' + n[0] + '</button>';
          });
          q(el, '#trk').innerHTML = h;
          q(el, '#tmsg').textContent = nodes[sel][0] + ': ' + nodes[sel][1];
          qa(el, '[data-n]').forEach(function (b) { b.onclick = function () { sel = +b.dataset.n; draw(); }; });
        }
        draw();
      }
    };
  };

  /* ---------- content ---------- */
  var P = {
    contract: {
      label: 'Contract Ingest', sub: 'Read a contract packet and verify what it found',
      facts: [['Start from', 'Admin Processes > Contract > Ingest, or the button on a Contract'], ['Input', 'A .zip, or the PDFs and Excel files, for one contract'], ['Who can run it', 'Administrator and Business Development']],
      steps: [
        { t: 'Open and pick the contract', demo: 'c1', lead: 'Tell the tool who the other party is and which contract this packet belongs to.',
          do: ['Open Admin Processes, then Contract > Ingest in the left rail. From a Contract record, use its Contract Ingest button instead and the contract is already chosen.', 'Pick Customer or Vendor. This decides what the tool looks for.', 'Choose the contract from the list. The Backlog tab lists contracts still waiting for a packet, and its Ingest button brings you here.'],
          changes: 'Nothing yet.', trouble: [] },
        { t: 'Add the files', demo: 'c2', lead: 'Attach the whole packet to the contract.',
          do: ['Drop the packet on the box, or press Choose files.', 'Use one .zip, or the PDFs and Excel files.', 'Scanned PDFs with no text layer must be run through OCR on Beau\'s PC first.'],
          changes: 'The files are attached to the contract. Nothing else changes.',
          trouble: [['A file shows No text layer later', 'It is a scan. Run OCR on Beau\'s PC, add the searchable copy, and read again. Files already read are not duplicated.']] },
        { t: 'Read the files', demo: 'c3', lead: 'Start the read and wait for it to finish. Try the example run.',
          do: ['Press Read the files.', 'Each file gets a chip: Parsed, No text layer, or Skipped.', 'Wait for the bar. It checks every 5 seconds and stops waiting after 10 minutes.', 'When it ends, read the four tiles: Terms, Rate lines, Clauses, Documents.'],
          changes: 'The tool proposes terms, rate lines and clauses. A Note on the contract records what the run did.',
          trouble: [['Says "already read earlier"', 'The packet has not changed, so nothing new was proposed. Open the existing review.'], ['Still reading after 10 minutes', 'The read may still be running. Press Check again, or open the Contract record and look for the Note.'], ['Contract shows Failed', 'Open the Contract Documents and the Note for the reason, fix the file, add it and read again.']] },
        { t: 'Review each item', demo: 'c4', lead: 'Nothing is trusted until a person has looked at it. Try the example review.',
          do: ['Press Open review.', 'For each rate line and clause, read the citation and source sentence.', 'Confirm, Edit or Reject it.'],
          changes: 'Rejected rate lines are marked Rejected in review. Confirmed items move from Proposed to Verified.', trouble: [] },
        { t: 'Verify the contract', demo: 'c5', lead: 'Close the review once nothing is pending.',
          do: ['Press Verify when no items are pending.', 'Check the contract now reads Ingested.'],
          changes: 'The contract becomes Ingested and Last Verified is set to today. The vendor-cost margin check runs on the contract.',
          trouble: [] }
      ],
      results: [
        ['Ingest status (Not Ingested, Backlog, Failed, Needs Review, Ingested)', 'The Contract record, and the Contract Review Band on its related list'],
        ['Each file and whether it was read', 'Contract Documents, a related list on the Contract'],
        ['Proposed, then Verified, rate lines', 'Rate Lines subform on the Contract; read-only panel in Contract Terms'],
        ['Proposed, then Confirmed, clauses', 'Contract Clauses'],
        ['What the run did, in words', 'A Note on the Contract, dated after the run started'],
        ['Stuck or failed contracts across the whole book', 'Contracts Flow tab: Packet in, Read, Reviewed, Margin checked, Renewal'],
        ['Margin against vendor cost after Verify', 'Contract margin detail, from the vendor-cost margin check']
      ]
    },
    billing: {
      label: 'Billing Ingest', sub: 'Check one vendor\'s monthly invoice',
      facts: [['Start from', 'Admin Processes > Billing > Run'], ['Input', 'One zip per vendor per month: invoice(s) plus daily assigned-device and spare-device files'], ['Who can run it', 'Administrator only']],
      steps: [
        { t: 'Build the vendor zip', demo: 'b1', lead: 'Put everything for one vendor and one month in a single zip.',
          do: ['Download the vendor\'s invoice(s) for the month.', 'Add the daily assigned-device files and the daily spare-device files from the vendor system.', 'Zip them as one file for that vendor and month.'],
          changes: 'Nothing in the CRM yet.', trouble: [] },
        { t: 'Create the month and attach the zip', demo: 'b2', lead: 'The Run screen creates the Billing Period and attaches the zip in one press. Try the example.',
          do: ['Open Admin Processes > Billing > Run.', 'Step 1: pick the month and the vendor (Allied, SCRAM, SuperCom, Buddi or Drug Testing).', 'Step 2: choose the vendor zip.', 'Press Create month and attach.'],
          changes: 'A Billing Period exists in status Open with the zip attached. If the month already exists, the zip is added to it.', trouble: [] },
        { t: 'Press Reconcile', demo: 'b3', lead: 'Reconcile starts the check. It runs from the button on the Billing Period record. Try the example.',
          do: ['On the Run screen, step 3, press Open month, then press Reconcile. The Billing Period record opens.', 'Click Reconcile on the record.', 'Watch the status move from Open to Reconciling.', 'Back on the Run screen, press Check run status until Last Run Status and Last Run At fill in.'],
          changes: 'The pipeline writes the findings, a Billing Run, and the initials and device ID into each finding\'s Participant.',
          trouble: [['The month shows no check run', 'The vendor zip has not been ingested for that month. Check the zip is attached, then press Reconcile.']] },
        { t: 'Confirm the counts', demo: 'b4', lead: 'Before you review, make sure what loaded matches what the run reported.',
          do: ['Open Admin Processes > Billing > Findings and pick that month.', 'A green banner means the findings loaded match the totals on the Billing Period.', 'A mismatch note means the load and the run disagree. Do not review yet.'],
          changes: 'Nothing changes. This is a safety check.',
          trouble: [['The banner says counts differ', 'Do not review yet. The loaded findings do not match the totals on the Billing Period. Tell Beau.']] },
        { t: 'Read the matrix', demo: 'b5', lead: 'Findings are grouped by vendor and type. Try clicking a count.',
          do: ['Look at the grid of vendor by type: Duplicate, Enrollment, Month-over-month, Preflight, Rate & math, Repair, Spare units, Tie-out.', 'Click a count to list those findings.', 'Click a row for its description and recommended action.'],
          changes: 'Nothing changes. Reading only.', trouble: [] },
        { t: 'Decide each money finding', demo: 'b6', lead: 'Overbilled and Unverified items carry dollars and need a decision.',
          do: ['Open the finding record.', 'Set the status and write a Decision note.', 'A $0 Latent item is information only.'],
          changes: 'Each decided finding has a status and a Decision note.', trouble: [] },
        { t: 'Close out the month', demo: 'b7', lead: 'When decisions are in, the month moves toward Reconciled.',
          do: ['Check the month moved to In Review, then Reconciled.', 'Read Recommended Pay to see what to pay the vendor.', 'If it landed on Needs Attention or Frozen, open it and read why.'],
          changes: 'The Billing Period shows invoiced, verified, on hold, recommended pay and last run.',
          trouble: [] }
      ],
      results: [
        ['One row per month: status, invoiced, verified, on hold, recommended pay, last run', 'Billing Periods (Administrator only)'],
        ['Every difference found, with Participant, Type, severity, dollars, status', 'Billing Findings module; Billing Findings tab, vendor-by-type matrix'],
        ['Path from month to money to close-out, plus stuck-month alerts', 'Billing Flow tab (Administrator only; planned, not yet run inside Zoho)'],
        ['Run history and the intake log', 'Billing Runs; the Run details section on the Billing Period'],
        ['Margin on actual billing', 'EM Margin rows written by billing runs, shown in Pricing Flow']
      ]
    }
  };

  /* ---------- render ---------- */
  function renderRail() {
    var p = P[cur], n = p.steps.length, d = Object.keys(done[cur]).length;
    $('progtext').textContent = d + ' of ' + n + ' done';
    $('progbar').style.width = (d / n * 100) + '%';
    $('steps').innerHTML = p.steps.map(function (s, i) {
      return '<li><button type="button" class="step' + (done[cur][i] ? ' done' : '') + '" data-i="' + i + '"' + (i === idx[cur] ? ' aria-current="step"' : '') + '>' +
        '<span class="num">' + (done[cur][i] ? '&#10003;' : (i + 1)) + '</span><span class="t">' + s.t + '</span></button></li>';
    }).join('');
    qa($('steps'), '[data-i]').forEach(function (b) { b.onclick = function () { go(+b.dataset.i); }; });
  }

  function renderPanel() {
    var p = P[cur], i = idx[cur], s = p.steps[i], last = i === p.steps.length - 1;
    var demo = demos[s.demo]();
    var h = '<div><div class="kicker">Step ' + (i + 1) + ' of ' + p.steps.length + '</div><h2>' + s.t + '</h2><p class="lead">' + s.lead + '</p></div>' +
      '<div><h3>What you do</h3><ol class="plain">' + s.do.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol></div>' +
      '<div><h3>What you will see</h3><div class="mock" id="mock">' + demo.html + '</div></div>' +
      '<div><h3>What changes in the CRM</h3><p>' + s.changes + '</p></div>';
    if (s.trouble.length) {
      h += '<div class="trouble"><h3>If it goes wrong</h3>' + s.trouble.map(function (t) { return '<details><summary>' + t[0] + '</summary><p>' + t[1] + '</p></details>'; }).join('') + '</div>';
    }
    h += '<div class="nav"><button class="btn" id="back" type="button"' + (i === 0 ? ' disabled' : '') + '>Back</button>' +
      '<button class="btn primary" id="next" type="button">' + (last ? 'Mark done' : 'Mark done and continue') + '</button></div>';
    $('panel').innerHTML = h;
    demo.bind($('mock'));
    $('back').onclick = function () { go(i - 1); };
    $('next').onclick = function () {
      done[cur][i] = true; save();
      if (!last) idx[cur] = i + 1;
      clearTimers(); renderRail(); renderPanel();
      if (!last) $('panel').scrollIntoView({ block: 'start', behavior: 'smooth' });
    };
  }

  function go(i) { clearTimers(); idx[cur] = i; renderRail(); renderPanel(); }

  function renderFacts() {
    $('facts').innerHTML = P[cur].facts.map(function (f) { return '<div class="fact"><b>' + f[0] + '</b>' + f[1] + '</div>'; }).join('');
  }

  function renderResults() {
    var f = $('filter').value.toLowerCase();
    $('rbody').innerHTML = P[cur].results.filter(function (r) { return !f || (r[0] + ' ' + r[1]).toLowerCase().indexOf(f) > -1; })
      .map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join('') || '<tr><td colspan="2">No match.</td></tr>';
  }

  function render() { renderFacts(); renderRail(); renderPanel(); renderResults(); }

  $('filter').oninput = renderResults;
  $('reset').onclick = function () { done[cur] = {}; idx[cur] = 0; save(); clearTimers(); render(); };
  var kd = function (e) {
    if (!sh.host.isConnected) return;
    var t = e.composedPath && e.composedPath()[0] && e.composedPath()[0].tagName;
    if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
    if (e.key === 'ArrowRight' && idx[cur] < P[cur].steps.length - 1) go(idx[cur] + 1);
    if (e.key === 'ArrowLeft' && idx[cur] > 0) go(idx[cur] - 1);
  };
  if (state.kd) document.removeEventListener('keydown', state.kd);
  state.kd = kd; document.addEventListener('keydown', kd);
  state.stop = clearTimers;
  render();
  }
  function view(key, title, sub) {
    return function (root, ctx) {
      X = ctx;
      var st = STATE[key]; if (st.stop) { try { st.stop(); } catch (e) {} }
      root.innerHTML = '<div class="wrap">' + X.head('Processes', title, sub, '', '') + X.switchHtml() + X.demoNote() + '<div id="pg-host" style="padding:16px"></div></div>';
      X.bindSwitch();
      var host = document.getElementById('pg-host');
      var sh = host.attachShadow({ mode: 'open' });
      sh.innerHTML = '<style>' + CSS + '</style><div class="pgroot">' +
        '<div class="facts" id="facts"></div>' +
        '<div class="main"><aside class="rail" aria-label="Steps"><div class="rail-top"><span id="progtext"></span><button id="reset" type="button">Reset</button></div><div class="bar"><i id="progbar"></i></div><ol class="steps" id="steps"></ol></aside>' +
        '<section class="panel" id="panel" aria-live="polite"></section></div>' +
        '<section class="results" aria-labelledby="rh"><div class="row" style="justify-content:space-between"><h2 id="rh">Where to find results</h2><input type="text" id="filter" placeholder="Filter, for example margin" aria-label="Filter results"></div>' +
        '<div class="tbl-wrap"><table><thead><tr><th>What</th><th>Where</th></tr></thead><tbody id="rbody"></tbody></table></div></section></div>';
      mountGuide(sh, key, st);
    };
  }
  RM.guide_contract = { key: 'guide_contract', title: 'Contract guide', swLabel: 'Contract steps', group: 'Guide', entity: 'Contracts', custom: true, render: view('contract', 'Contract Ingest guide', 'Step through it, try the example screens') };
  RM.guide_billing = { key: 'guide_billing', title: 'Billing guide', swLabel: 'Billing steps', group: 'Guide', entity: 'Billing_Periods', custom: true, render: view('billing', 'Billing Ingest guide', 'Step through it, try the example screens') };
})();
