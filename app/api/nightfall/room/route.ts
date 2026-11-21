import { handleRoomRequest } from "../../../../lib/nightfall/room-store";

const maxBytes = 64 * 1024;
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "Expected a JSON request." }, { status: 415, headers });
  }
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let size = 0;
  try {
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          void reader.cancel().catch(() => {});
          return Response.json({ error: "Room request is too large." }, { status: 413, headers });
        }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    }
  } catch {
    return Response.json({ error: "Unreadable room request." }, { status: 400, headers });
  }
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    return Response.json({ error: "Invalid JSON request." }, { status: 400, headers });
  }
  const { body: result, status } = handleRoomRequest(input);
  return Response.json(result, { status, headers });
}
