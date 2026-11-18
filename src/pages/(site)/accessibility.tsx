/** Accessibility statement (D-56). Keep "How we check" in step with the smoke suite and docs/verification.md. */

import { Contact, LegalPage, LegalSection } from '@/components/legal/LegalPage'

export default function AccessibilityPage() {
  return (
    <LegalPage title="Accessibility" description="What Model Court aims for, how it is checked, what is known not to work yet, and how to tell us.">
      <LegalSection id="goal" title="Our goal">
        <p>Model Court aims to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA, so that judges and jurors can take part with a keyboard, a screen reader, zoom, or reduced motion.</p>
      </LegalSection>

      <LegalSection id="how" title="How we check">
        <ul>
          <li>Every release runs automated WCAG 2.2 A and AA checks (axe) on the public pages in light and dark themes, and fails on any violation.</li>
          <li>Worksheets can be scored entirely by keyboard: 0, 1 and 2 score the focused line, and J and K move between answers.</li>
          <li>Animations stop when your device asks for reduced motion.</li>
        </ul>
      </LegalSection>

      <LegalSection id="known" title="Known limits">
        <ul>
          <li>Pages behind sign-in have not yet had a full manual review with a screen reader or at 200% zoom.</li>
          <li>Automated checks find only some problems; some issues need a person to notice them.</li>
        </ul>
      </LegalSection>

      <LegalSection id="tell" title="Tell us">
        <p>
          If something gets in your way, write to <Contact /> with the page and what happened. We aim to reply within five working days, and we can help you take part another way in the meantime.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
