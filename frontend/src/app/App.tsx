import { Route, Routes } from "react-router-dom";

import { ProgressPage } from "../features/generation/ProgressPage";
import { ResultPage } from "../features/model-viewer/ResultPage";
import { ReportPage } from "../features/quality-report/ReportPage";
import { MaskPage } from "../features/segmentation/MaskPage";
import { UploadPage } from "../features/upload/UploadPage";
import { WorldPage } from "../features/world/WorldPage";
import { Layout } from "./Layout";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<UploadPage />} />
        <Route path="projects/:projectId/mask" element={<MaskPage />} />
        <Route path="jobs/:jobId" element={<ProgressPage />} />
        <Route path="jobs/:jobId/result" element={<ResultPage />} />
        <Route path="jobs/:jobId/world" element={<WorldPage />} />
        <Route path="jobs/:jobId/report" element={<ReportPage />} />
        <Route path="*" element={<p>페이지가 없습니다.</p>} />
      </Route>
    </Routes>
  );
}
