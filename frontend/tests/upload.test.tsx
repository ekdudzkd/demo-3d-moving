import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UploadPage, precheck } from "../src/features/upload/UploadPage";
import { api } from "../src/services/api";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<UploadPage />} />
        <Route path="/projects/:projectId/mask" element={<p>mask page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function pick(file: File) {
  fireEvent.change(screen.getByTestId("file-input"), { target: { files: [file] } });
}

const png = () => new File(["x"], "a.png", { type: "image/png" });
const base = { is_valid: true, width: 1024, height: 1024, has_alpha: false, object_count: 1, object_coverage: 0.15 };

describe("UploadPage", () => {
  beforeEach(() => {
    vi.spyOn(api, "health").mockRejectedValue(new Error("offline"));
  });
  afterEach(() => vi.restoreAllMocks());
  globalThis.URL.createObjectURL = () => "blob:preview";

  it("precheck는 형식과 크기를 거른다", () => {
    expect(precheck(new File(["x"], "a.gif", { type: "image/gif" }))).toMatch(/PNG/);
    expect(precheck(png(), 0)).toMatch(/MB/);
    expect(precheck(png())).toBeNull();
  });

  it("서버가 거부하면 이유를 보여준다", async () => {
    vi.spyOn(api, "createProject").mockResolvedValue({
      ok: false,
      validation: { ...base, is_valid: false, errors: [{ code: "resolution_too_low", message: "짧은 변이 512px 이상이어야 합니다." }], warnings: [] },
    });
    renderPage();
    pick(png());
    expect(await screen.findByText("이 이미지는 사용할 수 없어요")).toBeInTheDocument();
    expect(screen.getByText("짧은 변이 512px 이상이어야 합니다.")).toBeInTheDocument();
  });

  it("통과하면 경고를 보여주고 객체 선택으로 이동한다", async () => {
    vi.spyOn(api, "createProject").mockResolvedValue({
      ok: true,
      project: {
        id: "prj_1",
        status: "MASK_PROPOSED",
        width: 1024,
        height: 1024,
        validation: {
          ...base,
          warnings: [{ code: "object_small", message: "객체가 작습니다." }],
        },
        original_url: "/x.png",
        masks: [],
        confirmed_mask_version: null,
        job_ids: [],
        created_at: "",
      },
    });
    renderPage();
    pick(png());
    expect(await screen.findByText("입력 검사 통과")).toBeInTheDocument();
    expect(screen.getByText("객체가 작습니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("객체 선택으로 →"));
    await waitFor(() => expect(screen.getByText("mask page")).toBeInTheDocument());
  });

  it("지원하지 않는 형식은 서버에 보내지 않는다", async () => {
    const spy = vi.spyOn(api, "createProject");
    renderPage();
    pick(new File(["x"], "a.gif", { type: "image/gif" }));
    expect(await screen.findByText(/PNG, JPG, WEBP/)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });
});
