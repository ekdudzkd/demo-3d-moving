// 입력 계층. 키보드·마우스(와 나중에 손동작)를 같은 이벤트로 바꿔 종목 코드에 준다.
//   step   {side: "L"|"R"}     좌우 번갈아 걷기·젓기 (키보드 F=L, J=R)
//   jump                       점프 (Space)
//   key    {code}              눌린 키 (반복 제외)
//   down / move / up {x, y}    포인터, 0~1 정규화 좌표 (화면 왼쪽 위가 0,0)
export function createInput(surface) {
  const held = new Set();
  const subs = new Map();
  const pointer = { x: 0.5, y: 0.5, down: false };
  const api = {
    held,
    pointer,
    enabled: true,
    on(name, fn) {
      if (!subs.has(name)) subs.set(name, new Set());
      subs.get(name).add(fn);
      return () => subs.get(name).delete(fn);
    },
    emit(name, data) {
      if (!api.enabled && name !== "free") return;
      subs.get(name)?.forEach((fn) => fn(data));
    },
    isHeld: (code) => held.has(code),
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      surface.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    },
  };

  const typing = () => /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || "");
  const GAME_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "KeyF", "KeyJ", "KeyE", "Enter"]);

  function onKeyDown(e) {
    if (typing()) return;
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    held.add(e.code);
    api.emit("key", { code: e.code });
    if (e.code === "KeyF") api.emit("step", { side: "L", via: "key" });
    if (e.code === "KeyJ") api.emit("step", { side: "R", via: "key" });
    if (e.code === "Space") api.emit("jump", { via: "key" });
  }
  function onKeyUp(e) {
    held.delete(e.code);
    api.emit("keyup", { code: e.code });
  }
  function onBlur() {
    held.clear();
    pointer.down = false;
  }
  const norm = (e) => {
    const r = surface.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, cx: e.clientX, cy: e.clientY };
  };
  function onDown(e) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const p = norm(e);
    pointer.x = p.x;
    pointer.y = p.y;
    pointer.down = true;
    api.emit("down", p);
  }
  function onMove(e) {
    const p = norm(e);
    pointer.x = p.x;
    pointer.y = p.y;
    api.emit("move", p);
  }
  function onUp(e) {
    const p = norm(e);
    pointer.x = p.x;
    pointer.y = p.y;
    if (!pointer.down) return;
    pointer.down = false;
    api.emit("up", p);
  }
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  surface.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  return api;
}
