// 월드 화면 위에 올리는 간단한 HUD 도구. 모양은 기존 데모의 카드·버튼 스타일을 그대로 따른다.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function createHud(root) {
  const layer = root.querySelector(".wf-event");
  const toasts = root.querySelector(".wf-toasts");

  const api = {
    esc,
    layer,
    clear() {
      layer.replaceChildren();
    },
    /** 이벤트 HUD 조각을 만든다. place: tl | tr | bl | br | tc | center */
    box(html, place = "tl", cls = "") {
      const el = document.createElement("div");
      el.className = `wf-box wf-${place} ${cls}`;
      el.innerHTML = html;
      layer.append(el);
      return el;
    },
    toast(text, ms = 1800) {
      const t = document.createElement("div");
      t.className = "wf-toast";
      t.textContent = text;
      toasts.append(t);
      setTimeout(() => t.remove(), ms);
    },
    /** 시작 안내 카드. 버튼 또는 Enter로 시작 */
    intro({ title, lede, howto, best, onStart, onExit, startLabel = "시작" }) {
      const el = document.createElement("div");
      el.className = "wf-overlay";
      el.innerHTML = `<div class="wf-card">
        <h2>${esc(title)}</h2>
        <p class="wf-lede">${esc(lede)}</p>
        <dl class="wf-howto">${howto.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
        ${best ? `<p class="wf-best">${esc(best)}</p>` : ""}
        <div class="wf-row"><button class="ghost" data-x>나가기</button><button class="primary" data-go>${esc(startLabel)} <kbd>Enter</kbd></button></div>
      </div>`;
      layer.append(el);
      const go = () => {
        el.remove();
        onStart();
      };
      el.querySelector("[data-go]").addEventListener("click", go);
      el.querySelector("[data-x]").addEventListener("click", () => {
        el.remove();
        onExit();
      });
      el.querySelector("[data-go]").focus();
      return { go, el };
    },
    /** 결과 카드. rows: [[이름, 값]] */
    result({ title, rows, record, onAgain, onExit, note }) {
      const el = document.createElement("div");
      el.className = "wf-overlay";
      el.innerHTML = `<div class="wf-card">
        <h2>${esc(title)}</h2>
        ${record ? `<p class="wf-newrec">${esc(record)}</p>` : ""}
        <dl class="wf-rows">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
        ${note ? `<p class="wf-best">${esc(note)}</p>` : ""}
        <div class="wf-row"><button class="ghost" data-x>월드로 나가기</button><button class="primary" data-again>다시 하기 <kbd>Enter</kbd></button></div>
      </div>`;
      layer.append(el);
      el.querySelector("[data-again]").addEventListener("click", () => {
        el.remove();
        onAgain();
      });
      el.querySelector("[data-x]").addEventListener("click", () => {
        el.remove();
        onExit();
      });
      el.querySelector("[data-again]").focus();
      return el;
    },
    /** 3-2-1 카운트다운. 끝나면 done() */
    countdown(done, { beep, go } = {}) {
      const el = document.createElement("div");
      el.className = "wf-count";
      layer.append(el);
      let n = 3;
      let stopped = false;
      const tick = () => {
        if (stopped) return;
        if (n > 0) {
          el.textContent = n;
          beep?.();
          n--;
          setTimeout(tick, 800);
        } else {
          el.textContent = "출발!";
          go?.();
          setTimeout(() => el.remove(), 600);
          done();
        }
      };
      tick();
      return () => {
        stopped = true;
        el.remove();
      };
    },
    meter(label, init = 0, cls = "") {
      const el = document.createElement("div");
      el.className = `wf-meter ${cls}`;
      el.innerHTML = `<small><span>${esc(label)}</span><b></b></small><div class="wf-bar"><i></i></div>`;
      const fill = el.querySelector("i");
      const txt = el.querySelector("b");
      return {
        el,
        set(v, text = "", warn = false) {
          fill.style.width = `${Math.max(0, Math.min(1, v)) * 100}%`;
          txt.textContent = text;
          el.classList.toggle("warn", warn);
        },
      };
    },
    stat(label, init = "-") {
      const el = document.createElement("div");
      el.className = "wf-stat";
      el.innerHTML = `<small>${esc(label)}</small><strong>${esc(init)}</strong>`;
      const v = el.querySelector("strong");
      return { el, set: (t) => (v.textContent = t) };
    },
  };
  return api;
}
