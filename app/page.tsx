import Link from 'next/link'

export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-line">
        <div className="mx-auto max-w-[1200px] px-6 h-16 flex items-center justify-between">
          <span className="text-[15px] font-extrabold tracking-[-.02em]">Susu</span>
          <Link href="/login" className="text-[13px] font-semibold text-ink-2 hover:text-ink transition-colors">
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1">
        <div className="mx-auto max-w-[1200px] px-6 py-16 sm:py-24 grid lg:grid-cols-2 gap-14 lg:gap-20 items-center">

          <div>
            <span className="inline-block px-3 py-1.5 rounded-full bg-blue-lt text-blue text-[12px] font-semibold mb-7">
              Trusted rotating savings, run properly
            </span>

            <h1 className="text-[44px] sm:text-[58px] font-extrabold tracking-[-.04em] leading-[.98]">
              Save daily.
              <br />
              <span className="font-normal italic text-ink-2">Collect on</span>
              <br />
              your day.
            </h1>

            <p className="mt-6 text-[16px] text-ink-2 leading-relaxed max-w-[420px]">
              Everyone pays in each day. One member collects the whole pot on their
              turn. Your slot, your date, your money — tracked to the pesewa.
            </p>

            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/login" className="btn-blue btn-lg">Open your account</Link>
              <Link href="/admin/login" className="btn-line btn-lg">Admin sign in</Link>
            </div>

            <p className="mt-6 text-[13px] text-ink-3">
              Not a member yet? Ask your susu admin to add you.
            </p>
          </div>

          {/* Visual: the rotation, stated plainly. No illustration, no stock art. */}
          <div className="panel p-7 sm:p-9">
            <p className="t-label mb-6">How a cycle works</p>

            <div className="space-y-5">
              {[
                { k: 'Everyone pays', v: 'GHS 55', s: 'every day, before 6:00 PM' },
                { k: 'Group size',    v: '11 members', s: 'one collects per turn' },
                { k: 'Each turn',     v: '30 days', s: 'then the next member collects' },
              ].map(({ k, v, s }) => (
                <div key={k} className="flex items-baseline justify-between gap-4 pb-5 border-b border-line">
                  <div>
                    <p className="text-[14px] font-semibold">{k}</p>
                    <p className="text-[12px] text-ink-3 mt-0.5">{s}</p>
                  </div>
                  <p className="text-[18px] font-extrabold tnum whitespace-nowrap">{v}</p>
                </div>
              ))}
            </div>

            <div className="mt-7 well p-5 flex items-end justify-between gap-4">
              <div>
                <p className="t-label !text-blue">You collect</p>
                <p className="text-[11px] text-ink-2 mt-1.5">plus your registration fee back</p>
              </div>
              <p className="text-[34px] font-extrabold tracking-[-.03em] leading-none tnum text-blue">
                <span className="text-[15px] align-[.45em] mr-0.5">GHS</span>16,540
              </p>
            </div>
          </div>
        </div>

        {/* Two doors — plainly named */}
        <div className="border-t border-line bg-tint">
          <div className="mx-auto max-w-[1200px] px-6 py-14 grid sm:grid-cols-2 gap-4">
            <Link href="/login" className="panel p-6 hover:border-blue transition-colors group">
              <p className="t-label">For members</p>
              <p className="text-[19px] font-extrabold tracking-[-.02em] mt-2 group-hover:text-blue transition-colors">
                Open your account
              </p>
              <p className="t-meta mt-1.5">See your plan, pay contributions, track your collection date.</p>
            </Link>

            <Link href="/admin/login" className="panel p-6 hover:border-blue transition-colors group">
              <p className="t-label">For admins</p>
              <p className="text-[19px] font-extrabold tracking-[-.02em] mt-2 group-hover:text-blue transition-colors">
                Admin sign in
              </p>
              <p className="t-meta mt-1.5">Manage members, groups, contributions and payouts.</p>
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-[1200px] px-6 py-7 flex flex-wrap gap-3 items-center justify-between">
          <span className="text-[13px] font-bold">Susu</span>
          <span className="text-[12px] text-ink-3">Contributions close 6:00 PM daily. Late payments are flagged.</span>
        </div>
      </footer>
    </div>
  )
}
