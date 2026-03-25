import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { createRoom, deleteRoom, exchangeSession, fetchRoom, saveSubmission } from './lib/api';
import { decryptSubmission, encryptSubmission } from './lib/crypto';
import { ensureGoogleIdentityLoaded, fetchCalendarEvents, fetchGoogleCalendarList } from './lib/google';
import { aggregateRoom, availabilityFromGoogleEvents, buildEmptyAvailability, buildRoomSlots, getRoomDateKeys } from './lib/room';
import logoUrl from './assets/logo-120.png';
import type { DecryptedSubmission, Room } from './types';
import type { CalendarListEntry } from './lib/google';

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: TokenClientConfig) => TokenClient;
          revoke: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

type TokenResponse = {
  access_token: string;
  error?: string;
  error_description?: string;
};

type TokenClientConfig = {
  client_id: string;
  scope: string;
  callback: (response: TokenResponse) => void;
  error_callback?: (error: { type: string }) => void;
};

type TokenClient = {
  requestAccessToken: (options?: { prompt?: string }) => void;
};

type LocalOrganizerRoom = {
  roomId: string;
  title: string;
  participantLink: string;
  expiresAt?: string;
  savedAt: string;
};

type StoredSession = {
  sessionToken: string;
  expiresAt: string;
};

type CreatedRoomLinks = {
  roomId: string;
  participantLink: string;
  expiresAt: string;
};

type GoogleCalendarPickerState = {
  calendars: CalendarListEntry[];
  selectedIds: string[];
};

type DecryptedRoomSubmission = DecryptedSubmission & {
  submissionId: string;
};

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

function App() {
  return (
    <Routes>
      <Route path="/" element={<CreateRoomPage />} />
      <Route path="/rooms/:roomId" element={<ParticipantRoomPage />} />
      <Route path="/organize/:roomId" element={<OrganizerPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function CreateRoomPage() {
  const [title, setTitle] = useState('');
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [selectedDates, setSelectedDates] = useState(() => buildDefaultSelectedDates());
  const [calendarMonth, setCalendarMonth] = useState(() => monthKeyForDate(buildDefaultSelectedDates()[0] ?? localDateString(new Date())));
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(17);
  const [saveOnDevice, setSaveOnDevice] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<CreatedRoomLinks | null>(null);
  const [savedRooms, setSavedRooms] = useState<LocalOrganizerRoom[]>([]);
  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  const [copyState, setCopyState] = useState<'participant' | null>(null);
  const dateDragState = useRef<{ active: boolean; value: boolean | null; anchorDateKey: string | null }>({
    active: false,
    value: null,
    anchorDateKey: null,
  });

  useEffect(() => {
    setSavedRooms(listLocalOrganizerRooms());
  }, []);

  useEffect(() => {
    function handlePointerRelease() {
      dateDragState.current = { active: false, value: null, anchorDateKey: null };
    }

    window.addEventListener('pointerup', handlePointerRelease);
    return () => {
      window.removeEventListener('pointerup', handlePointerRelease);
    };
  }, []);

  async function handleCreateRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedDates.length === 0) {
      setError('Choose at least one possible date.');
      return;
    }
    if (startHour >= endHour) {
      setError('Daily end hour must be after the start hour.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const response = await createRoom({ title, timezone, selectedDates, startHour, endHour });
      setRetentionDays(response.retentionDays);
      setLinks({
        roomId: response.room.id,
        participantLink: response.participantLink,
        expiresAt: response.room.expiresAt,
      });
      setCopyState(null);

      if (saveOnDevice) {
        saveLocalOrganizerRoom(response.room.id, {
          title: response.room.title,
          participantLink: response.participantLink,
          expiresAt: response.room.expiresAt,
        });
      }

      setSavedRooms(listLocalOrganizerRooms());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to create room.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCopyLink() {
    const value = links?.participantLink;
    if (!value || !navigator.clipboard) {
      setError('Clipboard access is unavailable in this browser.');
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setCopyState('participant');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to copy link.');
    }
  }

  return (
    <main className="page-shell">
      <section className="panel hero">
        <BrandLockup />
        <h1>Privacy-preserving meeting scheduling</h1>
        <p className="lede">
          Create a meeting-time poll and share one participant link. Availability matching, decryption, and optional
          Google Calendar import all happen in each participant&apos;s browser, not on the server.
        </p>
        <p className="muted">
          Rooms auto-delete after {retentionDays ?? 30} days. Share the participant link, and only save it in this
          browser if you accept that risk.
        </p>

        <form className="create-room-layout" onSubmit={handleCreateRoom}>
          <div className="create-room-main">
            <label className="field-card">
              <span>Room title</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Board meeting, hiring interview, research sync"
                required
              />
            </label>

            <div className="time-fields">
              <label className="field-card">
                <span>Daily start hour</span>
                <select value={startHour} onChange={(event) => setStartHour(Number(event.target.value))}>
                  {hourOptions.slice(0, 24).map((hour) => (
                    <option key={hour} value={hour}>
                      {formatHour(hour)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-card">
                <span>Daily end hour</span>
                <select value={endHour} onChange={(event) => setEndHour(Number(event.target.value))}>
                  {hourOptions.slice(1).map((hour) => (
                    <option key={hour} value={hour}>
                      {formatHour(hour)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="checkbox-card">
              <input type="checkbox" checked={saveOnDevice} onChange={(event) => setSaveOnDevice(event.target.checked)} />
              <span>
                Save the participant link on this device
                <small className="muted">Convenient, but less safe if other people can access this browser profile.</small>
              </span>
            </label>

            <button className="primary submit-button" disabled={isSaving}>
              {isSaving ? 'Creating room...' : 'Create room'}
            </button>
          </div>

          <div className="field-card date-picker-card">
            <div className="date-picker-header">
              <div>
                <span>Possible dates</span>
                <p className="muted">
                  Select any combination of dates, like a specific-dates poll instead of one continuous range.
                </p>
              </div>
              <div className="date-picker-summary">
                <strong>{selectedDates.length}</strong>
                <span>{selectedDates.length === 1 ? 'date selected' : 'dates selected'}</span>
              </div>
            </div>
            <SpecificDatePicker
              selectedDates={selectedDates}
              monthKey={calendarMonth}
              onMonthChange={setCalendarMonth}
              onToggleDate={(dateKey, nextValue) => {
                dateDragState.current = { active: true, value: nextValue, anchorDateKey: dateKey };
                setSelectedDates((current) => setSelectedDateValue(current, dateKey, nextValue));
              }}
              onDragEnter={(dateKey) => {
                if (
                  dateDragState.current.active &&
                  dateDragState.current.value !== null &&
                  dateDragState.current.anchorDateKey
                ) {
                  const calendarDays = buildCalendarDays(new Date(`${calendarMonth}-01T00:00:00`));
                  setSelectedDates((current) =>
                    applyDateRangeValue(
                      current,
                      getDateKeysInRectangle(calendarDays, dateDragState.current.anchorDateKey!, dateKey),
                      dateDragState.current.value!,
                    ),
                  );
                }
              }}
              onDragEnd={() => {
                dateDragState.current = { active: false, value: null, anchorDateKey: null };
              }}
            />
            <div className="selected-date-list" aria-live="polite">
              {selectedDates.map((dateKey) => (
                <button
                  key={dateKey}
                  type="button"
                  className="selected-date-chip"
                  onClick={() => setSelectedDates((current) => current.filter((value) => value !== dateKey))}
                >
                  {formatDateChip(dateKey)} x
                </button>
              ))}
              {selectedDates.length > 0 ? (
                <button type="button" className="selected-date-chip clear-chip" onClick={() => setSelectedDates([])}>
                  Clear dates
                </button>
              ) : null}
            </div>
          </div>
        </form>

        {error ? <p className="error-banner">{error}</p> : null}
        {links ? (
          <div className="link-card">
            <div className="link-card-header">
              <div>
                <p className="eyebrow">Room Created</p>
                <h2>Store or send the links before you leave this page</h2>
              </div>
              <p className="muted">
                Room `{links.roomId}` expires on {formatDateTime(links.expiresAt)} and is then deleted automatically.
              </p>
            </div>

            <div className="link-grid">
              <article className="generated-link-card">
                <p className="generated-link-label">Participant link</p>
                <p className="muted">
                  Send this link to participants so they can submit encrypted availability.
                </p>
                <code>{links.participantLink}</code>
                <div className="action-row">
                  <button type="button" onClick={() => handleCopyLink()}>
                    {copyState === 'participant' ? 'Copied participant link' : 'Copy participant link'}
                  </button>
                  <a className="button-link secondary-link" href={links.participantLink}>
                    Open participant link
                  </a>
                </div>
              </article>
            </div>

            <div className="link-notes">
              <p className="muted">
                If you did not enable local saving, these capability links are only shown in this browser session right now.
              </p>
              <p className="muted">
                Saving them in the browser is optional and convenient, but anyone with access to this browser profile could reopen them.
              </p>
            </div>
          </div>
        ) : null}
      </section>

      <section className="panel my-rooms-panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Saved Links</p>
            <h2>Saved only when you opt in</h2>
          </div>
          <p className="muted">
            This list is stored locally for convenience. Clearing browser storage removes it.
          </p>
        </div>

        {savedRooms.length === 0 ? (
          <p className="muted">No participant links have been saved in this browser yet.</p>
        ) : (
          <div className="saved-room-list">
            {savedRooms.map((savedRoom) => (
              <article key={savedRoom.roomId} className="saved-room-card">
                <div>
                  <h3>{savedRoom.title}</h3>
                  <p className="muted">Expires {formatDateTime(savedRoom.expiresAt ?? null)}</p>
                  <p className="muted">Saved locally {formatDateTime(savedRoom.savedAt)}</p>
                </div>
                <div className="action-row">
                  <a className="button-link primary-link" href={savedRoom.participantLink}>
                    Open participant link
                  </a>
                  <button type="button" className="danger" onClick={() => removeSavedRoom(savedRoom.roomId, setSavedRooms)}>
                    Remove local copy
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer className="site-footer">
        <a className="inline-link" href="https://kollnig.net/privacy/" target="_blank" rel="noreferrer">
          Privacy policy
        </a>
      </footer>
    </main>
  );
}

function OrganizerPage() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const roomId = params.roomId ?? '';
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [encryptionSecret, setEncryptionSecret] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [decryptedSubmissions, setDecryptedSubmissions] = useState<DecryptedRoomSubmission[]>([]);
  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const slots = useMemo(() => (room ? buildRoomSlots(room) : []), [room]);
  const aggregate = useMemo(() => aggregateRoom(slots, decryptedSubmissions), [slots, decryptedSubmissions]);

  useEffect(() => {
    if (!roomId) {
      setError('Missing room id.');
      setIsLoading(false);
      return;
    }

    const fragmentKey = new URLSearchParams(window.location.hash.slice(1)).get('key');
    if (fragmentKey) {
      setEncryptionSecret(fragmentKey);
    }

    void bootstrapSession({
      roomId,
      capabilityType: 'organizer',
      capability: searchParams.get('cap') ?? searchParams.get('secret'),
      scrubPath: `/organize/${roomId}`,
      onSuccess: (value) => setSessionToken(value.sessionToken),
      onError: setError,
    });
  }, [roomId, searchParams]);

  useEffect(() => {
    if (!roomId || !sessionToken || !encryptionSecret) {
      if (sessionToken && !encryptionSecret) {
        setIsLoading(false);
        setError('Missing room decryption key. Re-open the original organizer access link for this room.');
      }
      return;
    }

    void loadRoom(roomId, sessionToken, encryptionSecret, {
      setRoom,
      setRetentionDays,
      setDecryptedSubmissions,
      setDisplayName: () => {},
      setAvailability: () => {},
      setError,
      setIsLoading,
      hydrateOwnSubmission: false,
    });
  }, [roomId, sessionToken, encryptionSecret]);

  async function handleDelete() {
    if (!roomId || !sessionToken) {
      return;
    }

    setDeleting(true);
    try {
      await deleteRoom(roomId, sessionToken);
      clearSession('organizer', roomId);
      window.location.assign('/');
    } catch (caught) {
      clearSession('organizer', roomId);
      setError(caught instanceof Error ? caught.message : 'Failed to delete room.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="panel">
        <PageActions />
        <p className="eyebrow">Organizer controls</p>
        <h1>Room administration</h1>
        <p className="lede">
          This owner page uses a short-lived organizer session after the capability link is exchanged and scrubbed.
        </p>
        <p className="muted">
          Re-open the original organizer access link if this session expires or you clear this browser session.
        </p>
        {room ? (
          <p className="muted">
            This room expires on {formatDateTime(room.expiresAt)}. Current retention is {retentionDays ?? 30} days.
          </p>
        ) : null}
        {error ? <p className="error-banner">{error}</p> : null}
        {room ? (
          <>
            <div className="status-grid">
              <div>
                <dt>Timezone</dt>
                <dd>{room.timezone}</dd>
              </div>
              <div>
                <dt>Selected dates</dt>
                <dd>{summarizeRoomDates(room)}</dd>
              </div>
              <div>
                <dt>Participants</dt>
                <dd>{aggregate.participantCount}</dd>
              </div>
              <div>
                <dt>Exact matches</dt>
                <dd>{aggregate.exactMatches.length}</dd>
              </div>
            </div>

            <AvailabilityGrid room={room} slots={slots} aggregate={aggregate} />
          </>
        ) : null}
        {isLoading ? <p className="muted">Loading encrypted room data...</p> : null}
        <button className="danger" disabled={deleting || !sessionToken} onClick={handleDelete}>
          {deleting ? 'Deleting room...' : 'Delete room'}
        </button>
      </section>
    </main>
  );
}

function ParticipantRoomPage() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const roomId = params.roomId ?? '';
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [encryptionSecret, setEncryptionSecret] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [decryptedSubmissions, setDecryptedSubmissions] = useState<DecryptedRoomSubmission[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRequestingGoogleAuth, setIsRequestingGoogleAuth] = useState(false);
  const [isImportingGoogle, setIsImportingGoogle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  const [googleState, setGoogleState] = useState<{ ready: boolean; tokenClient: TokenClient | null; accessToken: string | null }>({
    ready: false,
    tokenClient: null,
    accessToken: null,
  });
  const [googleCalendarPicker, setGoogleCalendarPicker] = useState<GoogleCalendarPickerState | null>(null);
  const dragState = useRef<{ active: boolean; value: boolean | null }>({ active: false, value: null });
  const googleAuthInFlightRef = useRef(false);
  const googleAccessTokenRef = useRef<string | null>(null);

  const slots = useMemo(() => (room ? buildRoomSlots(room) : []), [room]);
  const aggregate = useMemo(() => aggregateRoom(slots, decryptedSubmissions), [slots, decryptedSubmissions]);
  const ownSubmissionId = useMemo(() => getSubmissionMetadata(roomId)?.submissionId ?? null, [roomId, decryptedSubmissions]);
  const aggregateWithoutOwnSubmission = useMemo(
    () =>
      aggregateRoom(
        slots,
        ownSubmissionId
          ? decryptedSubmissions.filter((submission) => submission.submissionId !== ownSubmissionId)
          : decryptedSubmissions,
      ),
    [slots, decryptedSubmissions, ownSubmissionId],
  );
  useEffect(() => {
    if (!roomId) {
      setError('Missing room id.');
      setIsLoading(false);
      return;
    }

    const fragmentKey = new URLSearchParams(window.location.hash.slice(1)).get('key');
    if (fragmentKey) {
      setEncryptionSecret(fragmentKey);
    }

    void bootstrapSession({
      roomId,
      capabilityType: 'participant',
      capability: searchParams.get('cap') ?? searchParams.get('access'),
      scrubPath: `/rooms/${roomId}`,
      onSuccess: (value) => setSessionToken(value.sessionToken),
      onError: setError,
    });
  }, [roomId, searchParams]);

  useEffect(() => {
    if (!clientId) {
      return;
    }

    void ensureGoogleIdentityLoaded()
      .then(() => {
        if (!window.google?.accounts.oauth2) {
          return;
        }

        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: CALENDAR_SCOPE,
          callback: (response) => {
            googleAuthInFlightRef.current = false;
            setIsRequestingGoogleAuth(false);
            if (response.error) {
              setError(response.error_description ?? response.error);
              return;
            }

            setGoogleState((current) => ({ ...current, accessToken: response.access_token }));
            googleAccessTokenRef.current = response.access_token;
          },
          error_callback: (oauthError) => {
            googleAuthInFlightRef.current = false;
            setIsRequestingGoogleAuth(false);
            setError(`Google OAuth error: ${oauthError.type}`);
          },
        });

        setGoogleState((current) => ({ ...current, ready: true, tokenClient }));
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : 'Failed to load Google sign-in.');
      });
  }, []);

  useEffect(() => {
    if (!roomId || !sessionToken || !encryptionSecret) {
      if (sessionToken && !encryptionSecret) {
        setIsLoading(false);
        setError('Missing room decryption key. Re-open the original participant link for this room.');
      }
      return;
    }

    void loadRoom(roomId, sessionToken, encryptionSecret, {
      setRoom,
      setRetentionDays,
      setDecryptedSubmissions,
      setDisplayName,
      setAvailability,
      setError,
      setIsLoading,
    });
  }, [roomId, sessionToken, encryptionSecret]);

  useEffect(() => {
    function handlePointerRelease() {
      dragState.current = { active: false, value: null };
    }

    window.addEventListener('pointerup', handlePointerRelease);
    return () => {
      window.removeEventListener('pointerup', handlePointerRelease);
    };
  }, []);

  useEffect(() => {
    if (!room || !googleState.accessToken) {
      return;
    }

    let cancelled = false;
    const accessToken = googleState.accessToken;

    async function loadGoogleCalendars() {
      try {
        const calendars = await fetchGoogleCalendarList(accessToken);
        if (!cancelled) {
          const orderedCalendars = [...calendars].sort((left, right) => {
            if (left.primary && !right.primary) {
              return -1;
            }
            if (!left.primary && right.primary) {
              return 1;
            }
            return left.summary.localeCompare(right.summary);
          });
          setGoogleCalendarPicker({
            calendars: orderedCalendars,
            selectedIds: (orderedCalendars.find((calendar) => calendar.primary)
              ? orderedCalendars.filter((calendar) => calendar.primary)
              : orderedCalendars.slice(0, 1)
            ).map((calendar) => calendar.id),
          });
          setIsRequestingGoogleAuth(false);
          googleAuthInFlightRef.current = false;
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Failed to import Google availability.');
          revokeGoogleAccess(accessToken);
        }
      }
    }

    void loadGoogleCalendars();

    return () => {
      cancelled = true;
    };
  }, [room, googleState.accessToken]);

  function revokeGoogleAccess(accessToken = googleState.accessToken) {
    if (accessToken) {
      window.google?.accounts.oauth2.revoke(accessToken);
    }
    googleAccessTokenRef.current = null;
    setGoogleState((current) => ({ ...current, accessToken: null }));
    setGoogleCalendarPicker(null);
    setIsImportingGoogle(false);
    setIsRequestingGoogleAuth(false);
    googleAuthInFlightRef.current = false;
  }

  useEffect(() => {
    if (!googleCalendarPicker || isImportingGoogle) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        revokeGoogleAccess(googleAccessTokenRef.current);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [googleCalendarPicker, isImportingGoogle]);

  useEffect(() => {
    function handleBeforeUnload() {
      if (googleAccessTokenRef.current) {
        window.google?.accounts.oauth2.revoke(googleAccessTokenRef.current);
        googleAccessTokenRef.current = null;
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (googleAccessTokenRef.current) {
        window.google?.accounts.oauth2.revoke(googleAccessTokenRef.current);
        googleAccessTokenRef.current = null;
      }
    };
  }, []);

  function updateSlot(slotKey: string, nextValue: boolean) {
    setAvailability((current) => ({
      ...current,
      [slotKey]: nextValue,
    }));
  }

  function handleGoogleAutofill() {
    if (isImportingGoogle || isRequestingGoogleAuth || googleAuthInFlightRef.current) {
      return;
    }

    const tokenClient = googleState.tokenClient;
    if (!tokenClient) {
      return;
    }

    googleAuthInFlightRef.current = true;
    tokenClient.requestAccessToken({ prompt: googleState.accessToken ? '' : 'consent' });
    setIsRequestingGoogleAuth(true);
  }

  function toggleGoogleCalendar(calendarId: string) {
    setGoogleCalendarPicker((current) => {
      if (!current) {
        return current;
      }

      const selectedIds = current.selectedIds.includes(calendarId)
        ? current.selectedIds.filter((id) => id !== calendarId)
        : [...current.selectedIds, calendarId];

      return {
        ...current,
        selectedIds,
      };
    });
  }

  async function handleGoogleImportConfirm() {
    if (!room || !googleState.accessToken || !googleCalendarPicker) {
      return;
    }

    setIsImportingGoogle(true);
    setError(null);
    const accessToken = googleState.accessToken;

    try {
      const slotList = buildRoomSlots(room);
      const roomDates = getRoomDateKeys(room);
      const timeMin = new Date(`${roomDates[0] ?? room.startDate}T00:00:00`).toISOString();
      const timeMax = new Date(`${roomDates.at(-1) ?? room.endDate}T23:59:59`).toISOString();
      const { events } = await fetchCalendarEvents(accessToken, googleCalendarPicker.selectedIds, timeMin, timeMax);
      const importedAvailability = availabilityFromGoogleEvents(slotList, events, room.timezone);
      setAvailability(importedAvailability);
      revokeGoogleAccess(accessToken);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to import Google availability.');
      revokeGoogleAccess(accessToken);
    }
  }

  function handleGoogleImportCancel() {
    revokeGoogleAccess();
  }

  async function handleSave() {
    if (!room || !sessionToken || !encryptionSecret) {
      return;
    }

    if (!displayName.trim()) {
      setError('Choose a display name before saving your availability.');
      return;
    }

    try {
      setIsSaving(true);
      setError(null);
      const payload: DecryptedSubmission = {
        displayName: displayName.trim(),
        availabilityBySlot: availability,
      };
      const envelope = await encryptSubmission(room.id, encryptionSecret, payload);
      const existing = getSubmissionMetadata(room.id);
      const saved = await saveSubmission({
        roomId: room.id,
        sessionToken,
        submissionId: existing?.submissionId,
        editToken: existing?.editToken,
        envelope,
      });

      saveSubmissionMetadata(room.id, saved);
      void loadRoom(room.id, sessionToken, encryptionSecret, {
        setRoom,
        setRetentionDays,
        setDecryptedSubmissions,
        setDisplayName,
        setAvailability,
        setError: (value) => {
          if (value) {
            console.error('Background room refresh failed after save:', value);
          }
        },
        setIsLoading: () => {},
      });
    } catch (caught) {
      if (caught instanceof Error && caught.message.includes('401')) {
        clearSession('participant', room.id);
      }
      setError(caught instanceof Error ? caught.message : 'Failed to save encrypted submission.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="panel">
        <PageActions />
        <p className="eyebrow">Participant room</p>
        <h1>{room?.title ?? 'Loading room...'}</h1>
        <p className="lede">
          The participant capability is exchanged once for a short-lived session, then all submissions are
          decrypted locally in your browser.
        </p>
        <p className="muted">
          If you connect Google Calendar, the access token stays in memory only, is not stored by this app, and is
          revoked immediately after the busy slots are imported.
        </p>
        {room ? (
          <p className="muted">
            This room expires on {formatDateTime(room.expiresAt)}. Current retention is {retentionDays ?? 30} days.
          </p>
        ) : null}
        {error ? <p className="error-banner">{error}</p> : null}

        {room ? (
          <>
            <div className="status-grid">
              <div>
                <dt>Timezone</dt>
                <dd>{room.timezone}</dd>
              </div>
              <div>
                <dt>Selected dates</dt>
                <dd>{summarizeRoomDates(room)}</dd>
              </div>
              <div>
                <dt>Participants</dt>
                <dd>{aggregate.participantCount}</dd>
              </div>
              <div>
                <dt>Exact matches</dt>
                <dd>{aggregate.exactMatches.length}</dd>
              </div>
            </div>

            <div className="controls">
              <label>
                <span>Your display name</span>
                <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Konrad" />
              </label>
              <div className="action-row">
                <button className="primary" onClick={handleSave} disabled={isSaving || isLoading}>
                  {isSaving ? 'Saving encrypted submission...' : 'Save availability'}
                </button>
                <button
                  onClick={handleGoogleAutofill}
                  disabled={isLoading || !googleState.ready || isImportingGoogle || isRequestingGoogleAuth}
                >
                  {isRequestingGoogleAuth
                    ? 'Waiting for Google...'
                    : isImportingGoogle
                      ? 'Importing from Google...'
                      : 'Import Google Calendar securely'}
                </button>
                <button onClick={() => setAvailability(buildEmptyAvailability(slots))} disabled={isLoading}>
                  Clear grid
                </button>
              </div>
            </div>

            <AvailabilityGrid
              room={room}
              slots={slots}
              aggregate={aggregateWithoutOwnSubmission}
              selectedAvailability={availability}
              currentParticipantLabel={displayName.trim() || 'You'}
              onToggleSlot={(slotKey, nextValue) => {
                dragState.current = { active: true, value: nextValue };
                updateSlot(slotKey, nextValue);
              }}
              onDragEnter={(slotKey) => {
                if (dragState.current.active && dragState.current.value !== null) {
                  updateSlot(slotKey, dragState.current.value);
                }
              }}
              onDragEnd={() => {
                dragState.current = { active: false, value: null };
              }}
            />

            {googleCalendarPicker ? (
              <div
                className="modal-backdrop"
                role="presentation"
                onClick={() => {
                  if (!isImportingGoogle) {
                    handleGoogleImportCancel();
                  }
                }}
              >
                <section
                  className="modal-card"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="google-import-title"
                  onClick={(event) => event.stopPropagation()}
                >
                  <p className="eyebrow">Google import</p>
                  <h2 id="google-import-title">Choose calendars to include</h2>
                  <p className="muted">
                    Your Google token is only kept in memory for this import and will be revoked immediately after you
                    import or cancel.
                  </p>
                  <div className="calendar-picker-list">
                    {googleCalendarPicker.calendars.map((calendar) => (
                      <label key={calendar.id} className="calendar-picker-item">
                        <input
                          type="checkbox"
                          checked={googleCalendarPicker.selectedIds.includes(calendar.id)}
                          onChange={() => toggleGoogleCalendar(calendar.id)}
                          disabled={isImportingGoogle}
                        />
                        <span>
                          {calendar.summary}
                          {calendar.primary ? ' (primary)' : ''}
                          {calendar.timeZone ? ` · ${calendar.timeZone}` : ''}
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="action-row">
                    <button
                      className="primary"
                      onClick={handleGoogleImportConfirm}
                      disabled={isImportingGoogle || googleCalendarPicker.selectedIds.length === 0}
                    >
                      {isImportingGoogle ? 'Importing from Google...' : 'Import selected calendars'}
                    </button>
                    <button onClick={handleGoogleImportCancel} disabled={isImportingGoogle}>
                      Cancel and revoke access
                    </button>
                  </div>
                </section>
              </div>
            ) : null}
          </>
        ) : null}

        {isLoading ? <p className="muted">Loading encrypted room data...</p> : null}
      </section>
    </main>
  );
}

function PageActions() {
  return (
    <div className="page-actions">
      <Link className="brand-link" to="/">
        <img className="brand-logo brand-logo-small" src={logoUrl} alt="When2Blind logo" />
        <span className="eyebrow">When2Blind</span>
      </Link>
      <Link className="button-link secondary-link" to="/">
        Back to start page
      </Link>
    </div>
  );
}

function BrandLockup() {
  return (
    <div className="brand-lockup">
      <img className="brand-logo" src={logoUrl} alt="When2Blind logo" />
      <div>
        <p className="eyebrow">When2Blind</p>
      </div>
    </div>
  );
}

async function bootstrapSession(input: {
  roomId: string;
  capabilityType: 'organizer' | 'participant';
  capability: string | null;
  scrubPath: string;
  onSuccess: (value: StoredSession) => void;
  onError: (value: string) => void;
}) {
  const stored = loadSession(input.capabilityType, input.roomId);
  const capability = input.capability?.trim();

  if (capability) {
    window.history.replaceState({}, document.title, input.scrubPath);
    try {
      const session = await exchangeSession({
        roomId: input.roomId,
        capabilityType: input.capabilityType,
        capability,
      });
      const storedSession = {
        sessionToken: session.sessionToken,
        expiresAt: session.expiresAt,
      };
      saveSession(input.capabilityType, input.roomId, storedSession);
      input.onSuccess(storedSession);
      return;
    } catch (caught) {
      clearSession(input.capabilityType, input.roomId);
      input.onError(caught instanceof Error ? caught.message : 'Failed to exchange capability for a session.');
      return;
    }
  }

  if (stored) {
    input.onSuccess(stored);
    return;
  }

  input.onError(`Missing ${input.capabilityType} capability. Re-open the original link for this room.`);
}

async function loadRoom(
  roomId: string,
  sessionToken: string,
  encryptionSecret: string,
  handlers: {
    setRoom: (room: Room) => void;
    setRetentionDays: (value: number) => void;
    setDecryptedSubmissions: (value: DecryptedRoomSubmission[]) => void;
    setDisplayName: (value: string) => void;
    setAvailability: (value: Record<string, boolean>) => void;
    setError: (value: string | null) => void;
    setIsLoading: (value: boolean) => void;
    hydrateOwnSubmission?: boolean;
  },
) {
  try {
    handlers.setIsLoading(true);
    handlers.setError(null);
    const response = await fetchRoom(roomId, sessionToken);
    handlers.setRetentionDays(response.retentionDays);
    const decrypted = await Promise.all(
      response.submissions.map(async (submission) => ({
        ...(await decryptSubmission(roomId, encryptionSecret, submission.envelope)),
        submissionId: submission.id,
      })),
    );

    const nextSlots = buildRoomSlots(response.room);
    const defaultAvailability = buildEmptyAvailability(nextSlots);
    if (handlers.hydrateOwnSubmission === false) {
      handlers.setRoom(response.room);
      handlers.setDecryptedSubmissions(decrypted);
      return;
    }

    const existingData = getSubmissionMetadata(response.room.id);
    const existingSubmission = existingData
      ? response.submissions.find((submission) => submission.id === existingData.submissionId)
      : null;

    if (existingSubmission) {
      const decryptedOwnSubmission = await decryptSubmission(roomId, encryptionSecret, existingSubmission.envelope);
      handlers.setDisplayName(decryptedOwnSubmission.displayName);
      handlers.setAvailability({
        ...defaultAvailability,
        ...decryptedOwnSubmission.availabilityBySlot,
      });
    } else {
      handlers.setAvailability(defaultAvailability);
    }

    handlers.setRoom(response.room);
    handlers.setDecryptedSubmissions(decrypted);
  } catch (caught) {
    handlers.setError(caught instanceof Error ? caught.message : 'Failed to load room.');
  } finally {
    handlers.setIsLoading(false);
  }
}

function SpecificDatePicker(input: {
  selectedDates: string[];
  monthKey: string;
  onMonthChange: (value: string) => void;
  onToggleDate: (dateKey: string, nextValue: boolean) => void;
  onDragEnter: (dateKey: string) => void;
  onDragEnd: () => void;
}) {
  const monthStart = new Date(`${input.monthKey}-01T00:00:00`);
  const calendarDays = buildCalendarDays(monthStart);
  const selectedSet = new Set(input.selectedDates);

  return (
    <div className="date-picker-grid">
      <div className="date-picker-nav">
        <button type="button" onClick={() => input.onMonthChange(shiftMonth(input.monthKey, -1))}>
          Prev
        </button>
        <strong>{formatMonthHeading(monthStart)}</strong>
        <button type="button" onClick={() => input.onMonthChange(shiftMonth(input.monthKey, 1))}>
          Next
        </button>
      </div>
      <div className="date-picker-actions">
        <button type="button" onClick={() => input.onMonthChange(monthKeyForDate(localDateString(new Date())))}>
          Today
        </button>
      </div>
      <div className="weekday-row">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="calendar-grid">
        {calendarDays.map((day) => {
          const isSelected = selectedSet.has(day.dateKey);
          return (
            <button
              key={day.dateKey}
              type="button"
              className={`calendar-day${day.inMonth ? '' : ' outside-month'}${isSelected ? ' selected-day' : ''}`}
              aria-pressed={isSelected}
              onPointerDown={(event) => {
                event.preventDefault();
                input.onToggleDate(day.dateKey, !isSelected);
              }}
              onPointerEnter={() => input.onDragEnter(day.dateKey)}
              onPointerUp={input.onDragEnd}
              onBlur={input.onDragEnd}
            >
              <span>{day.dayNumber}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function buildDefaultSelectedDates() {
  const today = new Date();
  return Array.from({ length: 7 }, (_, offset) => {
    const value = new Date(today);
    value.setDate(today.getDate() + offset);
    return localDateString(value);
  });
}

function setSelectedDateValue(current: string[], dateKey: string, nextValue: boolean) {
  const isSelected = current.includes(dateKey);

  if (nextValue === isSelected) {
    return current;
  }

  if (!nextValue) {
    return current.filter((value) => value !== dateKey);
  }

  if (current.length >= 31) {
    return current;
  }

  return [...current, dateKey].sort();
}

function applyDateRangeValue(current: string[], dateKeys: string[], nextValue: boolean) {
  const currentSet = new Set(current);

  if (!nextValue) {
    for (const dateKey of dateKeys) {
      currentSet.delete(dateKey);
    }
    return [...currentSet].sort();
  }

  const missingDateKeys = dateKeys.filter((dateKey) => !currentSet.has(dateKey));
  const remainingCapacity = 31 - currentSet.size;
  for (const dateKey of missingDateKeys.slice(0, Math.max(remainingCapacity, 0))) {
    currentSet.add(dateKey);
  }

  return [...currentSet].sort();
}

function getDateKeysInRectangle(
  calendarDays: Array<{ dateKey: string }>,
  startDateKey: string,
  endDateKey: string,
) {
  const indexByDate = new Map(calendarDays.map((day, index) => [day.dateKey, index]));
  const startIndex = indexByDate.get(startDateKey);
  const endIndex = indexByDate.get(endDateKey);

  if (startIndex === undefined || endIndex === undefined) {
    return [startDateKey];
  }

  const startRow = Math.floor(startIndex / 7);
  const startColumn = startIndex % 7;
  const endRow = Math.floor(endIndex / 7);
  const endColumn = endIndex % 7;
  const minRow = Math.min(startRow, endRow);
  const maxRow = Math.max(startRow, endRow);
  const minColumn = Math.min(startColumn, endColumn);
  const maxColumn = Math.max(startColumn, endColumn);
  const dateKeys: string[] = [];

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      const day = calendarDays[row * 7 + column];
      if (day) {
        dateKeys.push(day.dateKey);
      }
    }
  }

  return dateKeys;
}

function buildCalendarDays(monthStart: Date) {
  const start = new Date(monthStart);
  start.setDate(1 - monthStart.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const value = new Date(start);
    value.setDate(start.getDate() + index);
    return {
      dateKey: localDateString(value),
      dayNumber: value.getDate(),
      inMonth: value.getMonth() === monthStart.getMonth(),
    };
  });
}

function shiftMonth(monthKey: string, offset: number) {
  const [year, month] = monthKey.split('-').map(Number);
  const value = new Date(year, month - 1 + offset, 1);
  return monthKeyForDate(localDateString(value));
}

function monthKeyForDate(dateKey: string) {
  return dateKey.slice(0, 7);
}

function formatMonthHeading(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(value);
}

function formatDateChip(dateKey: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${dateKey}T12:00:00`));
}

function summarizeRoomDates(room: Pick<Room, 'selectedDates' | 'startDate' | 'endDate'>) {
  const roomDates = getRoomDateKeys(room);
  if (roomDates.length === 0) {
    return 'No dates selected';
  }

  if (roomDates.length <= 4) {
    return roomDates.map(formatDateChip).join(', ');
  }

  return `${roomDates.length} dates from ${formatDateChip(roomDates[0])} to ${formatDateChip(roomDates.at(-1) ?? roomDates[0])}`;
}

const hourOptions = Array.from({ length: 25 }, (_, hour) => hour);

function formatHour(hour: number) {
  if (hour === 24) {
    return '24:00';
  }

  return `${String(hour).padStart(2, '0')}:00`;
}

function localDateString(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateTime(value: string | null) {
  if (!value) {
    return 'the configured retention deadline';
  }

  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}

function sessionStorageKey(capabilityType: 'organizer' | 'participant', roomId: string) {
  return `session:${capabilityType}:${roomId}`;
}

function loadSession(capabilityType: 'organizer' | 'participant', roomId: string) {
  const raw = sessionStorage.getItem(sessionStorageKey(capabilityType, roomId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as StoredSession;
    if (new Date(parsed.expiresAt).getTime() < Date.now()) {
      sessionStorage.removeItem(sessionStorageKey(capabilityType, roomId));
      return null;
    }
    return parsed;
  } catch {
    sessionStorage.removeItem(sessionStorageKey(capabilityType, roomId));
    return null;
  }
}

function saveSession(capabilityType: 'organizer' | 'participant', roomId: string, value: StoredSession) {
  sessionStorage.setItem(sessionStorageKey(capabilityType, roomId), JSON.stringify(value));
}

function clearSession(capabilityType: 'organizer' | 'participant', roomId: string) {
  sessionStorage.removeItem(sessionStorageKey(capabilityType, roomId));
}

function getSubmissionMetadata(roomId: string) {
  const raw = sessionStorage.getItem(`submission:${roomId}`);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as { submissionId: string; editToken: string };
  } catch {
    sessionStorage.removeItem(`submission:${roomId}`);
    return null;
  }
}

function saveSubmissionMetadata(roomId: string, value: { submissionId: string; editToken: string }) {
  sessionStorage.setItem(`submission:${roomId}`, JSON.stringify(value));
}

function listLocalOrganizerRooms(): LocalOrganizerRoom[] {
  return Object.keys(localStorage)
    .filter((key) => key.startsWith('organizer-room:'))
    .map<LocalOrganizerRoom | null>((key) => {
      const roomId = key.replace('organizer-room:', '');
      const raw = localStorage.getItem(key);
      if (!raw) {
        return null;
      }

      try {
        const parsed = JSON.parse(raw) as Partial<LocalOrganizerRoom> & { savedAt?: string };
        if (typeof parsed.title !== 'string' || typeof parsed.participantLink !== 'string') {
          return null;
        }
        if ('organizerLink' in parsed) {
          localStorage.setItem(
            key,
            JSON.stringify({
              title: parsed.title,
              participantLink: parsed.participantLink,
              expiresAt: parsed.expiresAt,
              savedAt: parsed.savedAt ?? new Date().toISOString(),
            }),
          );
        }
        return {
          roomId,
          title: parsed.title,
          participantLink: parsed.participantLink,
          expiresAt: parsed.expiresAt,
          savedAt: parsed.savedAt ?? new Date().toISOString(),
        };
      } catch {
        return null;
      }
    })
    .filter((value): value is LocalOrganizerRoom => value !== null)
    .sort((left, right) => right.savedAt.localeCompare(left.savedAt));
}

function saveLocalOrganizerRoom(
  roomId: string,
  value: Omit<LocalOrganizerRoom, 'roomId' | 'savedAt'>,
) {
  localStorage.setItem(
    `organizer-room:${roomId}`,
    JSON.stringify({
      ...value,
      savedAt: new Date().toISOString(),
    }),
  );
}

function removeSavedRoom(roomId: string, setSavedRooms: (rooms: LocalOrganizerRoom[]) => void) {
  localStorage.removeItem(`organizer-room:${roomId}`);
  setSavedRooms(listLocalOrganizerRooms());
}

function AvailabilityGrid(input: {
  room: Room;
  slots: ReturnType<typeof buildRoomSlots>;
  aggregate: ReturnType<typeof aggregateRoom>;
  selectedAvailability?: Record<string, boolean>;
  currentParticipantLabel?: string;
  onToggleSlot?: (slotKey: string, nextValue: boolean) => void;
  onDragEnter?: (slotKey: string) => void;
  onDragEnd?: () => void;
}) {
  const [hoveredSlotKey, setHoveredSlotKey] = useState<string | null>(null);
  const exactSet = new Set(input.aggregate.exactMatches);
  const nearCountBySlot = new Map(input.aggregate.nearMatches.map((entry) => [entry.slotKey, entry.freeCount]));
  const namesBySlot = new Map(input.aggregate.nearMatches.map((entry) => [entry.slotKey, entry.displayNames]));

  return (
    <div className="grid-wrap">
      <div className="time-column">
        <div className="corner-cell" />
        {Array.from({ length: input.room.endHour - input.room.startHour }, (_, offset) => {
          const hour = input.room.startHour + offset;
          return <div key={hour} className="time-label">{`${String(hour).padStart(2, '0')}:00`}</div>;
        })}
      </div>
      <div className="matrix">
        {Array.from(new Set(input.slots.map((slot) => `${slot.dayIndex}:${slot.dateLabel}`))).map((entry) => {
          const [dayIndexString, dateLabel] = entry.split(':');
          const dayIndex = Number(dayIndexString);
          const daySlots = input.slots.filter((slot) => slot.dayIndex === dayIndex);

          return (
            <div key={entry} className="day-strip">
              <div className="day-header">{dateLabel}</div>
              {daySlots.map((slot) => {
                const freeCount = nearCountBySlot.get(slot.key) ?? 0;
                const displayNames = namesBySlot.get(slot.key) ?? [];
                const isInteractive = Boolean(input.onToggleSlot);
                const isSelected = input.selectedAvailability?.[slot.key] ?? false;
                const tooltipNames = isSelected
                  ? [input.currentParticipantLabel ?? 'You', ...displayNames]
                  : displayNames;
                const showTooltip = hoveredSlotKey === slot.key && tooltipNames.length > 0;
                const slotSummary = isSelected
                  ? freeCount > 0
                    ? `${input.currentParticipantLabel ?? 'You'} + ${freeCount} free`
                    : `${input.currentParticipantLabel ?? 'You'} is free`
                  : exactSet.has(slot.key)
                    ? 'All free'
                    : freeCount > 0
                      ? `${freeCount} free`
                      : 'No match';
                const className = [
                  'slot-cell',
                  isSelected ? 'selected' : '',
                  exactSet.has(slot.key) ? 'exact' : '',
                  freeCount > 0 ? `heat-${Math.min(freeCount, 4)}` : '',
                ]
                  .filter(Boolean)
                  .join(' ');

                return (
                  <button
                    key={slot.key}
                    type="button"
                    className={className}
                    disabled={!isInteractive}
                    aria-pressed={isSelected}
                    onPointerDown={(event) => {
                      if (!input.onToggleSlot) {
                        return;
                      }
                      event.preventDefault();
                      input.onToggleSlot(slot.key, !isSelected);
                    }}
                    onPointerEnter={() => {
                      setHoveredSlotKey(slot.key);
                      input.onDragEnter?.(slot.key);
                    }}
                    onPointerLeave={() => setHoveredSlotKey((current) => (current === slot.key ? null : current))}
                    onFocus={() => setHoveredSlotKey(slot.key)}
                    onPointerUp={() => input.onDragEnd?.()}
                    onBlur={() => {
                      setHoveredSlotKey((current) => (current === slot.key ? null : current));
                      input.onDragEnd?.();
                    }}
                  >
                    <span>{slot.timeLabel}</span>
                    <small>{slotSummary}</small>
                    {showTooltip ? (
                      <span className="slot-tooltip" role="tooltip">
                        {tooltipNames.join(', ')}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default App;
