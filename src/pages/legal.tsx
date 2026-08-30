import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PageActions, SiteFooter } from '../components/SiteChrome';

const LAST_UPDATED = '30 August 2026';
const IMPRESS_URL = 'https://kollnig.net/impress/';

function LegalPage({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <main className="page-shell">
      <section className="panel legal-page">
        <PageActions />
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="muted">Last updated: {LAST_UPDATED}</p>
        <div className="legal-body">{children}</div>
      </section>
      <SiteFooter />
    </main>
  );
}

function OperatorParagraph() {
  return (
    <p>
      When2Blind is a small, independent project operated by the individual named in the site notice at{' '}
      <a className="inline-link" href={IMPRESS_URL} target="_blank" rel="noreferrer">
        kollnig.net/impress/
      </a>
      , which also lists the postal address and contact details of the operator (&ldquo;we&rdquo;, &ldquo;us&rdquo;).
    </p>
  );
}

export function PrivacyPolicyPage() {
  return (
    <LegalPage eyebrow="Legal" title="Privacy policy">
      <h2>1. Who is responsible</h2>
      <OperatorParagraph />
      <p>
        This policy explains what happens to data when you use When2Blind at{' '}
        <code>when2blind.trackercontrol.org</code>, including the optional Google Calendar import.
      </p>

      <h2>2. In short</h2>
      <ul>
        <li>There are no user accounts, no advertising, no analytics and no third-party trackers.</li>
        <li>
          Participant names and availability are encrypted in your browser before they are sent to us. We store only
          ciphertext and cannot read it.
        </li>
        <li>
          If you choose to import your Google Calendar, your browser talks to Google directly. Calendar data and the
          Google access token never reach our servers.
        </li>
        <li>Rooms and everything in them are deleted automatically after 30 days.</li>
      </ul>

      <h2>3. Data we process</h2>
      <h3>3.1 Room metadata</h3>
      <p>
        When a room is created, our server stores the room title, time zone, the candidate dates and daily time window,
        the room identifier, the expiry date and salted hashes of the secret links. The room title is chosen by the
        organiser and is readable by us, so please do not put personal or confidential information in it.
      </p>
      <h3>3.2 Participant submissions</h3>
      <p>
        A participant&apos;s display name and availability are encrypted in the browser with a key that is contained in
        the fragment of the participant link. The fragment is never transmitted to our server. We receive and store only
        the encrypted envelope; decryption and the overlap calculation happen in the browsers of the participants and
        the organiser.
      </p>
      <h3>3.3 Technical data</h3>
      <p>
        Like any web service, our API sees the IP address, the requested endpoint and the timestamp of each request. We
        use this only to operate the service, to apply rate limits and to detect abuse; security-relevant events are
        logged without any secret values. These records are short-lived and are not used to build profiles.
      </p>
      <h3>3.4 Data stored in your browser</h3>
      <p>
        We do not use cookies. The application uses your browser&apos;s <code>sessionStorage</code> for the short-lived
        session token needed to talk to the API, and your browser&apos;s <code>localStorage</code> only if you
        explicitly tick the option to save a room link on your device. You can remove all of it by clearing site data
        for this domain.
      </p>

      <h2>4. Google Calendar integration</h2>
      <p>
        The Google Calendar import is optional; the availability grid can always be filled in by hand. If you use it,
        When2Blind requests read-only access to your calendars through Google&apos;s OAuth consent screen, using the
        scope <code>https://www.googleapis.com/auth/calendar.readonly</code>.
      </p>
      <ul>
        <li>
          The entire OAuth flow runs in your browser. Your browser requests the access token from Google and fetches your
          calendar list and events directly from the Google Calendar API.
        </li>
        <li>
          Events are turned into busy or free markers in the room&apos;s time grid locally on your device. Event titles,
          descriptions, locations and attendees are never uploaded, stored or shown to anyone else.
        </li>
        <li>
          The resulting availability is encrypted in your browser before it is submitted, exactly like manually entered
          availability.
        </li>
        <li>
          The Google access token is held in memory only, is never written to browser storage and is never sent to our
          server. It is revoked immediately after the import finishes, and it is discarded when you close or reload the
          page.
        </li>
        <li>We do not use refresh tokens, so When2Blind has no access to your calendar in the background.</li>
      </ul>
      <p>
        You can review and withdraw the access you granted at any time at{' '}
        <a
          className="inline-link"
          href="https://myaccount.google.com/permissions"
          target="_blank"
          rel="noreferrer"
        >
          myaccount.google.com/permissions
        </a>
        .
      </p>
      <p>
        <strong>Limited Use disclosure.</strong> When2Blind&apos;s use and transfer of information received from Google
        APIs adheres to the{' '}
        <a
          className="inline-link"
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noreferrer"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. Google user data is used solely to provide the availability import
        described above. It is not transferred to anyone else, is not used for advertising, is not sold, and is not used
        to train generalised artificial intelligence or machine learning models. No human reads your Google user data.
      </p>

      <h2>5. Legal bases</h2>
      <p>
        Where the GDPR applies, we process room metadata and encrypted submissions to perform the service you asked for
        (Art. 6(1)(b) GDPR). Technical data is processed on the basis of our legitimate interest in a secure and
        available service (Art. 6(1)(f) GDPR). The Google Calendar import is carried out on the basis of the consent you
        give in Google&apos;s consent screen (Art. 6(1)(a) GDPR), which you can withdraw at any time as described above.
      </p>

      <h2>6. Retention and deletion</h2>
      <ul>
        <li>Rooms, and all submissions belonging to them, are deleted automatically 30 days after creation.</li>
        <li>API session tokens expire after at most 12 hours and are then deleted.</li>
        <li>An organiser can delete a room, including all submissions, at any time from the organiser page.</li>
        <li>Security and rate-limiting records are kept only as long as needed for that purpose.</li>
      </ul>

      <h2>7. Recipients</h2>
      <p>
        We do not sell data and we do not share it with advertisers. Data is processed only by the hosting and database
        providers that run the website and its API on our behalf, under contract and on our instructions. Calendar
        requests go directly from your browser to Google; that exchange is governed by{' '}
        <a className="inline-link" href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
          Google&apos;s privacy policy
        </a>
        .
      </p>

      <h2>8. Your rights</h2>
      <p>
        Under the GDPR you have the right of access, rectification, erasure, restriction, data portability and objection,
        and the right to lodge a complaint with a supervisory authority. Please note that we cannot decrypt participant
        submissions and cannot identify which submission belongs to which person; to exercise a right over a specific
        room, please include the room link, or simply delete the room. Requests can be sent to the contact details in
        the{' '}
        <a className="inline-link" href={IMPRESS_URL} target="_blank" rel="noreferrer">
          site notice
        </a>
        .
      </p>

      <h2>9. Children</h2>
      <p>When2Blind is not directed at children under 16 and we do not knowingly collect their data.</p>

      <h2>10. Changes</h2>
      <p>
        We may update this policy, for example when the service changes. The current version is always available at{' '}
        <code>when2blind.trackercontrol.org/privacy/</code> and carries the date of the last update at the top.
      </p>
    </LegalPage>
  );
}

export function TermsOfServicePage() {
  return (
    <LegalPage eyebrow="Legal" title="Terms of service">
      <h2>1. Scope</h2>
      <OperatorParagraph />
      <p>
        These terms govern your use of the When2Blind website and API at <code>when2blind.trackercontrol.org</code> (the
        &ldquo;service&rdquo;). By using the service, you agree to them. If you do not agree, please do not use the
        service.
      </p>

      <h2>2. The service</h2>
      <p>
        When2Blind lets you create a scheduling room, share a link, and collect the availability of participants. Names
        and availability are encrypted in the browser, and the overlap is calculated in the browser. Participants may
        optionally import their availability from Google Calendar. The service is provided free of charge and without
        any user account.
      </p>

      <h2>3. Links instead of accounts</h2>
      <p>
        Access is granted by secret links. Anyone who has a room link can use the corresponding capability, and the
        participant link additionally contains the key needed to decrypt that room. You are responsible for sharing
        those links only with the people you intend to give access to, and for storing them safely. We cannot restore a
        lost link, and we cannot recover the contents of a room without it.
      </p>

      <h2>4. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>use the service unlawfully, or to harass, deceive or harm others;</li>
        <li>upload unlawful content, or content you have no right to share, including in room titles;</li>
        <li>
          attempt to gain unauthorised access to rooms, accounts or infrastructure, to guess or brute-force links, or to
          circumvent rate limits and other security measures;
        </li>
        <li>
          place an unreasonable load on the service, for instance by automated mass creation of rooms or submissions;
        </li>
        <li>use the service to build a competing product from data of other users.</li>
      </ul>

      <h2>5. Google Calendar</h2>
      <p>
        If you use the Google Calendar import, you must have the right to access the calendars you import, and your use
        of Google&apos;s services remains subject to Google&apos;s own terms. The import is read-only and happens
        entirely in your browser; how we handle it is described in the{' '}
        <Link className="inline-link" to="/privacy/">
          privacy policy
        </Link>
        . You can withdraw the access you granted at any time in your Google Account settings.
      </p>

      <h2>6. Availability and data loss</h2>
      <p>
        The service is offered as it is, without any guaranteed availability. Rooms and all data in them are deleted
        automatically 30 days after creation, and may become unavailable earlier through maintenance, technical faults
        or discontinuation of the service. Do not rely on When2Blind as a system of record, and export anything you need
        to keep.
      </p>

      <h2>7. No warranty</h2>
      <p>
        To the extent permitted by applicable law, the service is provided &ldquo;as is&rdquo; and &ldquo;as
        available&rdquo;, without warranties of any kind, whether express or implied, including fitness for a particular
        purpose and uninterrupted or error-free operation.
      </p>

      <h2>8. Liability</h2>
      <p>
        To the extent permitted by applicable law, we are not liable for indirect or consequential damage, loss of data,
        or lost profits arising from the use of, or inability to use, the service. Liability for intent and gross
        negligence, for injury to life, body or health, and any other liability that cannot be excluded under mandatory
        law, remains unaffected.
      </p>

      <h2>9. Termination</h2>
      <p>
        You may stop using the service at any time, and an organiser can delete a room, with all its submissions, from
        the organiser page. We may suspend or remove rooms, or restrict access, where this is necessary to comply with
        the law or to stop abuse of the service.
      </p>

      <h2>10. Changes to these terms</h2>
      <p>
        We may update these terms as the service develops. The current version is always available at{' '}
        <code>when2blind.trackercontrol.org/terms/</code> and carries the date of the last update at the top. Continued
        use of the service after a change means that you accept the updated terms.
      </p>

      <h2>11. Applicable law and contact</h2>
      <p>
        The law of the operator&apos;s place of residence, as stated in the site notice, applies, without prejudice to
        any mandatory consumer protection rules of the country in which you live. Contact details are available in the{' '}
        <a className="inline-link" href={IMPRESS_URL} target="_blank" rel="noreferrer">
          site notice
        </a>
        .
      </p>
    </LegalPage>
  );
}
