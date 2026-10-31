import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Offline",
};

export default function OfflinePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-xl font-semibold">You are offline</h1>
      <p className="text-fd-muted-foreground">
        This page has not been cached yet. Reconnect and try again.
      </p>
    </main>
  );
}
