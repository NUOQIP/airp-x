import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { HomePage } from "./pages/HomePage";
import { PostPage } from "./pages/PostPage";
import { MessagesPage } from "./pages/MessagesPage";
import { LivePage } from "./pages/LivePage";
import { ConfigPage } from "./pages/ConfigPage";

export default function App() {
  return <AppShell>
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/post/:postId" element={<PostPage />} />
      <Route path="/messages" element={<MessagesPage />} />
      <Route path="/messages/:threadId" element={<MessagesPage />} />
      <Route path="/live" element={<LivePage />} />
      <Route path="/config" element={<ConfigPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </AppShell>;
}

