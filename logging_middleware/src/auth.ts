declare const process: {
  env: Record<string, string | undefined>;
};

declare const Buffer: {
  from(input: string, encoding: "base64" | "base64url" | "utf8"): { toString(encoding: "utf8"): string };
};

interface AuthPayload {
  email?: string;
  name?: string;
  rollNo?: string;
  accessCode?: string;
  clientID?: string;
  clientSecret?: string;
}

interface AuthResponse {
  access_token?: string;
  accessToken?: string;
  token?: string;
}

const AUTH_API_URL = "http://4.224.186.213/evaluation-service/auth";

function getEnvToken(): string | null {
  const token = process.env.AUTH_TOKEN ?? process.env.LOGGING_TOKEN;
  if (!token) {
    return null;
  }

  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function decodeJwtPayload(token: string): AuthPayload | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const base64Url = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf8");
    const payload = JSON.parse(json) as AuthPayload;

    return payload;
  } catch {
    return null;
  }
}

function pickFirstToken(value: AuthResponse | unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const response = value as AuthResponse;
  return response.access_token ?? response.accessToken ?? response.token ?? null;
}

export async function getAuthToken(forceRefresh: boolean = false): Promise<string | null> {
  const currentToken = getEnvToken();

  if (!forceRefresh && currentToken) {
    return currentToken;
  }

  const refreshSource = currentToken ? decodeJwtPayload(currentToken) : null;
  const payload = {
    email: refreshSource?.email ?? process.env.AUTH_EMAIL,
    name: refreshSource?.name ?? process.env.AUTH_NAME,
    rollNo: refreshSource?.rollNo ?? process.env.AUTH_ROLLNO,
    accessCode: refreshSource?.accessCode ?? process.env.AUTH_ACCESS_CODE,
    clientID: refreshSource?.clientID ?? process.env.CLIENT_ID,
    clientSecret: refreshSource?.clientSecret ?? process.env.CLIENT_SECRET,
  };

  if (!payload.email || !payload.name || !payload.rollNo || !payload.accessCode || !payload.clientID || !payload.clientSecret) {
    return currentToken;
  }

  try {
    const response = await fetch(AUTH_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return currentToken;
    }

    const responseBody = (await response.json()) as AuthResponse;
    const freshToken = pickFirstToken(responseBody);

    if (!freshToken) {
      return currentToken;
    }

    process.env.AUTH_TOKEN = freshToken;
    return freshToken;
  } catch {
    return currentToken;
  }
}
