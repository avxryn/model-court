/** Terms of use (D-56). Draft until LEGAL.draft is false and the placeholders are filled. */

import { Link } from 'react-router-dom'
import { Contact, LegalPage, LegalSection } from '@/components/legal/LegalPage'
import { LEGAL } from '@/lib/legal'

export default function TermsPage() {
  return (
    <LegalPage title="Terms" description="The rules for using Model Court, and what it does and does not promise.">
      <LegalSection id="agreement" title="Agreement">
        <p>
          These terms are between you and {LEGAL.operator}. By using Model Court, signed in or as a guest juror, you agree to them and to the <Link to="/privacy" className="underline underline-offset-4">privacy notice</Link>. You must be at least 16.
        </p>
      </LegalSection>

      <LegalSection id="service" title="What Model Court is">
        <p>
          Model Court helps you compare AI setups on your own questions: jurors score answers without knowing which setup wrote them, and you record a judgment. It is a decision aid. Its findings are not a benchmark, a certification, or a statement by us about any AI provider or model.
        </p>
      </LegalSection>

      <LegalSection id="keys" title="Your API keys and costs">
        <ul>
          <li>Hearings and the AI grader use your own OpenAI, Anthropic or Google API key. Those calls are billed to your provider account, and you are responsible for those charges.</li>
          <li>Use a key you can afford to lose: a dedicated key with a spending limit. Remove it when you are done.</li>
          <li>You must follow your provider’s terms and usage policies for everything sent with your key.</li>
          <li>Judges in the EEA, Switzerland or the UK must use a Gemini key from a paid-tier Google project.</li>
        </ul>
      </LegalSection>

      <LegalSection id="content" title="Your content">
        <ul>
          <li>You keep the rights to what you put in a case. You let us store it, process it, and show it to the people you invite, only to run the service.</li>
          <li>
            Use synthetic data, or data you have the right to use. Do not put in personal data about others without a lawful basis, or anything confidential you may not share with your jurors. Imported answers are shown to jurors as written.
          </li>
          <li>You are responsible for what you publish about a case’s results, including any statement about a named model or provider.</li>
        </ul>
      </LegalSection>

      <LegalSection id="conduct" title="Acceptable use">
        <p>Do not use Model Court to break the law, harass anyone, infringe others’ rights, send content that is illegal for an AI provider to receive, try to get around the blind review or another person’s access, probe or overload the service, or reverse-engineer other people’s data out of it.</p>
        <p>We may suspend access or remove content that breaks these terms. Report problems to <Contact />.</p>
      </LegalSection>

      <LegalSection id="jurors" title="Jurors">
        <p>
          Jurors score what the judge shows them. A filed worksheet cannot be changed, and becomes part of the judge’s record. Guest jurors are responsible for keeping their invitation and resume links private.
        </p>
      </LegalSection>

      <LegalSection id="trademarks" title="Names of models and providers">
        <p>OpenAI, GPT, Anthropic, Claude, Google, and Gemini are trademarks of their owners. Model Court names them only to identify which models you can compare. It is not affiliated with or endorsed by OpenAI, Anthropic or Google.</p>
      </LegalSection>

      <LegalSection id="warranty" title="No warranty, and limits of liability">
        <p>
          Model Court is provided as is and as available, without warranties of any kind, to the extent the law allows. We are not liable for provider charges, decisions made using the service, or indirect or consequential losses. Where liability cannot be excluded, it is limited to the amount you paid us in the last 12 months (zero if the service was free). Nothing here limits rights you have under the law where you live that cannot be waived.
        </p>
      </LegalSection>

      <LegalSection id="ending" title="Ending">
        <p>You can stop using Model Court and delete your cases at any time. We may change or end the service; if we end it, we will give reasonable notice where we can so you can take what you need.</p>
      </LegalSection>

      <LegalSection id="law" title="Law and changes">
        <p>
          These terms are governed by the laws of {LEGAL.jurisdiction}. If they change, the effective date at the top changes too, and continuing to use Model Court after that means you accept the new terms. Questions: <Contact />.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
