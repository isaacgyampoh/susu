import { redirect } from 'next/navigation'

// The console's sign-in is the root of this deployment.
export default function AdminLoginRedirect() {
  redirect('/')
}
