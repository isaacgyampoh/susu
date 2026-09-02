import type { Metadata } from 'next'
import { NO_REFUND, AFFORDABILITY } from '@/components/susu/payment-policy'

export const metadata: Metadata = {
  title: 'Payment and membership policy',
  robots: { index: true, follow: true },
}

/**
 * The rules, stated plainly.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Every clause below describes behaviour that is actually implemented and
 * tested. Nothing here is aspirational. Where a rule is enforced by the
 * system rather than by goodwill, it says so — a member reading this should
 * be able to trust it the way they trust their statement.
 *
 * The no-refund wording is imported rather than retyped, so this page and the
 * two payment screens cannot drift apart.
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <div className="text-sm text-ink-2 mt-2 space-y-2 leading-relaxed">{children}</div>
    </section>
  )
}

export default function PoliciesPage() {
  return (
    <main className="min-h-[100dvh] bg-bg px-5 py-10">
      <div className="max-w-2xl mx-auto">
        <p className="text-2xs font-semibold tracking-[.14em] uppercase text-ink-3">AbiSusus Group</p>
        <h1 className="text-2xl font-semibold text-ink mt-1.5">Payment and membership policy</h1>
        <p className="text-sm text-ink-2 mt-2">
          These are the rules your membership runs on. Please read them before you join.
        </p>

        <Section title="Payments are non-refundable">
          <p>{NO_REFUND}</p>
          <p>{AFFORDABILITY}</p>
          <p className="text-ink-3">
            There is no way for anyone to request a refund through this platform, and no
            refund is issued on forfeiture.
          </p>
        </Section>

        <Section title="Your contributions">
          <p>
            Each group has its own contribution amount and schedule. You are responsible for
            meeting the schedule of every group you join.
          </p>
          <p>
            A payment may cover more than one day. When it does, you are shown exactly which
            days it covered before you pay, and again afterwards on your statement.
          </p>
          <p>
            Money paid into one group is only ever used for that group. A payment towards
            Group A never settles anything in Group B, and any credit left over stays with
            the group that earned it.
          </p>
        </Section>

        <Section title="Groups and slots">
          <p>
            Your slot is your turn in the group&rsquo;s rotation, and it determines when you
            collect. Slots are set when the group starts.
          </p>
          <p>
            Once a group is running, a slot is only moved by an administrator, who must record
            a written reason. A slot whose payout has already been paid cannot be moved at all.
          </p>
        </Section>

        <Section title="If you fall behind">
          <p>
            A membership that defaults may be forfeited by an administrator, with a reason
            recorded. A forfeited membership stops its remaining contributions, cancels its
            upcoming payout, and frees the slot.
          </p>
          <p>
            Having already contributed money does not by itself entitle a forfeited membership
            to the payout. Per the rules above, no refund applies.
          </p>
        </Section>

        <Section title="How payments are taken">
          <p>
            Payments are collected by mobile money through <strong>NaloPay</strong>. You approve
            each payment on your own phone.
          </p>
          <p>
            A payment is only ever recorded as received once NaloPay confirms it. Until then it
            shows as awaiting confirmation — a prompt appearing on your phone is not, by itself,
            a payment. If a payment does not complete, nothing is recorded against your
            contributions.
          </p>
        </Section>

        <Section title="Registration">
          <p>
            A registration fee is due when you apply. It is separate from your contributions and
            is never counted towards a contribution day.
          </p>
          <p>
            Your application is reviewed after the fee is confirmed. Paying the fee does not by
            itself approve your application, and a part-paid fee does not.
          </p>
        </Section>

        <Section title="Questions">
          <p>
            Speak to your susu administrator, or use the contact option in your member portal.
          </p>
        </Section>

        <p className="text-2xs text-ink-3 mt-10">
          Last updated 2 September 2026.
        </p>
      </div>
    </main>
  )
}
