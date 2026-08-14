import { Component, type ErrorInfo, type ReactNode } from "react";

type State = { error?: Error };

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("AIRP 页面渲染失败", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main className="grid min-h-screen place-items-center bg-slate-50 p-10">
      <section role="alert" className="max-w-lg rounded-2xl border border-line bg-white p-8 text-center shadow-xl">
        <h1 className="text-2xl font-extrabold">页面暂时无法显示</h1>
        <p className="mt-3 text-sm leading-6 text-muted">数据没有因此被删除。你可以重新载入页面；如果仍然出现，请查看服务端日志。</p>
        <button className="x-primary mt-5" onClick={() => window.location.reload()}>重新载入</button>
      </section>
    </main>;
  }
}
