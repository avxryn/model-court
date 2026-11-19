/**
 * Privacy notice (D-56). Every statement here describes what the code does;
 * change the code and this page together. Draft until LEGAL.draft is false.
 */

import { Contact, LegalPage, LegalSection } from '@/components/legal/LegalPage'
import { LEGAL } from '@/lib/legal'

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" description="What Model Court collects, why, where it goes, how long it stays, and how to have it removed.">
      <LegalSection id="who" title="Who is responsible">
        <p>
          {LEGAL.operator} runs this deployment of Model Court and is responsible for the data described here. Questions and requests: <Contact />.
        </p>
        <p>
          When you open a case, you decide what goes into it. If you put other people’s information into a case (for example, real support transcripts), you are responsible for having the right to use it; Model Court stores and shows it on your behalf.
        </p>
      </LegalSection>

      <LegalSection id="collect" title="What we collect">
        <ul>
          <li>
            <strong>Your account:</strong> your name, email address and user ID from the sign-in service (DeepSpace, through GitHub or Google). We use them to sign you in and to show your name to people on your cases.
          </li>
          <li>
            <strong>Your cases:</strong> titles, questions, reference evidence (exhibits), sources and your notes on them, scoring guides, system instructions, party names, imported answers, the AI answers a hearing collects, jurors’ scores and notes, and your judgment. We keep a record of who did what and when, so the record can be trusted.
          </li>
          <li>
            <strong>Provider API keys:</strong> encrypted before they are stored and never shown again. We record when each key was last used, and when it was last checked and whether it worked.
          </li>
          <li>
            <strong>Guest jurors:</strong> the display name they choose, and a sign-in cookie for their device. Only scrambled (hashed) versions of their secrets are stored.
          </li>
          <li>
            <strong>Network data:</strong> your IP address, briefly, to limit abuse (for example, how many guest joins come from one address). The hosting platform also keeps request logs.
          </li>
        </ul>
        <p>We do not use analytics, advertising, or tracking scripts, and we do not sell or share your data for advertising.</p>
      </LegalSection>

      <LegalSection id="providers" title="What is sent to AI providers">
        <p>
          Only when a judge starts or retries a hearing (or runs the AI grader after unsealing), Model Court sends requests to OpenAI or Anthropic using <strong>the judge’s own API key</strong>. A hearing request contains the party’s system instructions, the exhibit, the question, and any earlier conversation on that question. A grader request also contains the scoring guide and one answer.
        </p>
        <p>
          A task kit adds its fixed instructions to each hearing request, with the length limit and format for summaries or the list of allowed labels for classification. Its automatic checks run on Model Court’s server: nothing extra is sent to a provider, and answer keys (required points, phrases to avoid, expected labels) are never sent to a model.
        </p>
        <p>
          <strong>Field lists and documents.</strong> For a “pull fields from documents” case, each request also contains the document for that question and your field list (field names, descriptions and allowed values). If you upload a PDF and choose <strong>Send the PDF file</strong>, the file itself is sent to OpenAI or Anthropic with your key, and the provider reads its text and an image of each page. If you choose <strong>Send the text only</strong>, the PDF never leaves your browser; only the text you reviewed is saved and sent. Answer keys and jury instructions are never sent to a model. Anthropic keeps a compiled copy of the field list (not the document) for up to 24 hours to speed up later requests, so don’t put personal data in field names, descriptions, or allowed values.
        </p>
        <p>
          <strong>Sources.</strong> For an “answers from sources” case, each request also contains that question’s numbered sources, in your order, with their titles, and the same instructions on how to cite them. Every party’s provider gets the same sources. If you run the AI grader after unsealing, its request contains them and your grounding key too. Your notes on the sources (where a passage came from) and your grounding key (whether the sources answer the question, and which sources a good answer cites) are never sent to a model. Jurors of the hearing see the sources and the grounding key, but not your notes.
        </p>
        <p>
          When you choose <strong>Check key</strong> (or leave it on when saving a key), Model Court asks OpenAI or Anthropic to list its models using your key. This is free and sends no questions, answers, or case content.
        </p>
        <p>
          Scoring guides (for hearings), jurors’ scores and notes, juror identities, invitations, imported answers, and judgments are never sent to a model. What a provider does with requests is governed by your agreement with that provider; deleting a case here cannot delete what a provider already received.
        </p>
      </LegalSection>

      <LegalSection id="processors" title="Services we rely on">
        <ul>
          <li>DeepSpace, which hosts the app, stores its data, and provides sign-in.</li>
          <li>Cloudflare, the network DeepSpace runs on.</li>
          <li>OpenAI and Anthropic, only as described above and only with the judge’s key.</li>
        </ul>
        <p>These services may process data outside your country.</p>
      </LegalSection>

      <LegalSection id="retention" title="How long we keep it">
        <ul>
          <li>
            <strong>Cases</strong> stay until the judge deletes them. Deleting a case removes it and everything in it (hearings, answers, scores, notes, guest jurors, and its activity records) within 24 hours.
          </li>
          <li>
            <strong>Documents</strong> are stored with the case. Replacing or removing one deletes it within 24 hours unless a hearing still uses it; deleting the case deletes all of them within 24 hours. We don’t keep the file’s name. Deleting here can’t delete what a provider already received.
          </li>
          <li>
            <strong>Sources</strong> are stored with the case, and each hearing keeps its own unchangeable copy. Replacing or removing a question’s sources deletes the draft copy at once; deleting the case deletes all of them within 24 hours. Deleting here can’t delete what a provider already received.
          </li>
          <li>
            <strong>API keys</strong> expire 7 days after they are saved or renewed (an operator can set up to 90). A removed or expired key’s encrypted copy is deleted within a day, unless a hearing still records which key it used, in which case it is deleted with that case.
          </li>
          <li>
            <strong>Guest juror devices</strong> stop working after 14 days. Unused invitations are deleted 7 days after they expire.
          </li>
          <li>
            <strong>IP-based limits</strong> are deleted within an hour. Activity records not tied to a case are deleted after 30 days. Platform request logs are kept for up to 7 days.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="browser" title="Cookies and browser storage">
        <p>
          Guest jurors get one cookie that keeps them signed in to their worksheet; it is strictly necessary and is not used for tracking. Signing in uses the sign-in service’s own cookies. Your browser also remembers your theme, whether the sidebar is collapsed, a short-lived invitation token while you sign in, an unfinished new-case form (its template, title and decision, until you open the case or discard the draft), and your first name and initial so the home page can greet you. That last item is removed when you sign out.
        </p>
      </LegalSection>

      <LegalSection id="rights" title="Your choices and rights">
        <ul>
          <li>Delete a case at any time from its Case actions menu.</li>
          <li>Remove a saved API key at any time from Provider keys.</li>
          <li>
            Jurors’ filed scores are part of the case record and cannot be edited, so the record stays trustworthy. A juror who wants their name removed from a record can ask us to replace it with “Juror” and a number, or ask the judge to delete the case.
          </li>
          <li>
            You can ask for a copy of your data, a correction, or deletion of your account’s data by writing to <Contact />. Depending on where you live, you may also have the right to object or complain to a data protection authority.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="age" title="Age">
        <p>Model Court is not for anyone under 16, and we do not knowingly collect data from them.</p>
      </LegalSection>

      <LegalSection id="changes" title="Changes">
        <p>If this notice changes, the effective date at the top changes too. Significant changes will be shown in the app before they apply.</p>
      </LegalSection>
    </LegalPage>
  )
}
