import Link from 'next/link'

export default function Entry() {
  return (
    <div className="min-h-screen flex flex-col justify-center max-w-[380px] mx-auto px-6">
      <p className="t-label mb-3">Susu</p>
      <h1 className="t-display mb-2">Pay daily.<br />Collect on your day.</h1>
      <p className="t-meta mb-10">Your card, your slot, your collection date.</p>

      <div className="border-y border-line divide-y divide-line">
        <Link href="/login" className="flex items-baseline justify-between py-5 group">
          <div>
            <p className="text-[15px] font-bold group-hover:underline underline-offset-4">Open your card</p>
            <p className="t-meta mt-0.5">For members</p>
          </div>
          <span className="t-label group-hover:text-ink transition-colors">Go</span>
        </Link>
        <Link href="/admin/login" className="flex items-baseline justify-between py-5 group">
          <div>
            <p className="text-[15px] font-bold group-hover:underline underline-offset-4">Console</p>
            <p className="t-meta mt-0.5">For collectors</p>
          </div>
          <span className="t-label group-hover:text-ink transition-colors">Go</span>
        </Link>
      </div>

      <p className="t-meta mt-10">Not a member? Ask your susu collector.</p>
    </div>
  )
}
