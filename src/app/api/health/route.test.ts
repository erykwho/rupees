import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryRawMock } = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: queryRawMock,
  },
}));

import { GET } from "@/app/api/health/route";

describe("API GET /api/health", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it("retorna 200 ok sem consultar o banco por padrão", async () => {
    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");

    const body = (await res.json()) as { status: string; timestamp: string };
    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("string");
    expect(queryRawMock).not.toHaveBeenCalled();
  });

  it("retorna 200 db: unconfigured quando ?db=1 e DATABASE_URL não está definida", async () => {
    delete process.env.DATABASE_URL;
    const res = await GET(new Request("http://localhost/api/health?db=1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; db: string };
    expect(body.status).toBe("ok");
    expect(body.db).toBe("unconfigured");
    expect(queryRawMock).not.toHaveBeenCalled();
  });

  it("retorna 200 db: ok quando ?db=1 e o PostgreSQL responde", async () => {
    process.env.DATABASE_URL = "postgresql://ci:ci@localhost:5432/rupees_ci";
    queryRawMock.mockResolvedValue([{ "?column?": 1 }]);

    const res = await GET(new Request("http://localhost/api/health?db=1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; db: string };
    expect(body.status).toBe("ok");
    expect(body.db).toBe("ok");
    expect(queryRawMock).toHaveBeenCalledTimes(1);
  });

  it("retorna 503 degraded quando ?db=1 e a consulta ao banco falha", async () => {
    process.env.DATABASE_URL = "postgresql://ci:ci@localhost:5432/rupees_ci";
    queryRawMock.mockRejectedValue(new Error("connection refused"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(new Request("http://localhost/api/health?db=1"));
    errorSpy.mockRestore();

    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; db: string };
    expect(body.status).toBe("degraded");
    expect(body.db).toBe("error");
  });
});
