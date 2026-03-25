export type CalendarListEntry = {
  id: string;
  summary: string;
  primary?: boolean;
  timeZone?: string;
  backgroundColor?: string;
};

export type EventItem = {
  start?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  end?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  status?: string;
  transparency?: string;
};

let googleScriptPromise: Promise<void> | null = null;

export function ensureGoogleIdentityLoaded() {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }

  if (googleScriptPromise) {
    return googleScriptPromise;
  }

  googleScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services.'));
    document.head.appendChild(script);
  });

  return googleScriptPromise;
}

export async function fetchGoogleCalendarList(accessToken: string) {
  const calendarList = await fetchGoogle<{ items?: CalendarListEntry[] }>(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList',
    accessToken,
  );

  const calendars = calendarList.items ?? [];
  if (calendars.length === 0) {
    throw new Error('No calendars available for this Google account.');
  }

  return calendars;
}

export async function fetchCalendarEvents(
  accessToken: string,
  calendarIds: string[],
  timeMin: string,
  timeMax: string,
) {
  if (calendarIds.length === 0) {
    throw new Error('Choose at least one Google Calendar to import.');
  }

  const query = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    timeMin,
    timeMax,
  });

  const responses = await Promise.all(
    calendarIds.map((calendarId) =>
      fetchGoogle<{ items?: EventItem[] }>(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`,
        accessToken,
      ),
    ),
  );

  return {
    events: responses.flatMap((response) => (response.items ?? []).filter((event) => event.status !== 'cancelled')),
  };
}

async function fetchGoogle<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as T;
}
