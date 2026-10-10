import { afterEach, describe, expect, it, vi } from "vitest";

import { stepIndex } from "../src/app/steps";
import { ApiError, api } from "../src/services/api";

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("api", () => {
  it("업로드 거부(422)를 검사 결과로 돌려준다", async () => {
    mockFetch(422, { status: "REJECTED", validation: { is_valid: false, errors: [{ code: "resolution_too_low", message: "작음" }] } });
    const r = await api.createProject(new File(["x"], "a.png"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.validation.errors?.[0].code).toBe("resolution_too_low");
  });

  it("업로드 성공 시 프로젝트를 돌려준다", async () => {
    const fn = mockFetch(201, { id: "prj_1", status: "MASK_PROPOSED" });
    const r = await api.createProject(new File(["x"], "a.png"));
    expect(r.ok && r.project.id).toBe("prj_1");
    expect(fn.mock.calls[0][0]).toBe("/api/projects");
    expect(fn.mock.calls[0][1].body).toBeInstanceOf(FormData);
  });

  it("FastAPI detail을 오류 메시지로 쓴다", async () => {
    mockFetch(409, { detail: "마스크를 먼저 확정해 주세요." });
    await expect(api.createJob("prj_1")).rejects.toMatchObject({ status: 409, message: "마스크를 먼저 확정해 주세요." });
  });

  it("검증 오류 배열도 문장으로 만든다", async () => {
    mockFetch(422, { detail: [{ msg: "too big" }, { msg: "bad" }] });
    await expect(api.getJob("j")).rejects.toThrow("too big, bad");
  });

  it("네트워크 오류는 status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("failed")));
    const err = await api.health().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
  });

  it("segment는 JSON POST", async () => {
    const fn = mockFetch(201, { version: 2 });
    await api.segment("prj_1", { points: [{ x: 1, y: 2, label: 1 }] });
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe("/api/projects/prj_1/segment");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).points[0]).toEqual({ x: 1, y: 2, label: 1 });
  });
});

describe("stepIndex", () => {
  it.each([
    ["/", 0],
    ["/projects/prj_1/mask", 1],
    ["/jobs/job_1", 2],
    ["/jobs/job_1/result", 3],
    ["/jobs/job_1/world", 4],
    ["/jobs/job_1/report", 5],
  ])("%s → %i", (path, idx) => expect(stepIndex(path)).toBe(idx));
});
