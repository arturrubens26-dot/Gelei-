import { redirect } from "next/navigation";

/** /admin → /admin/dashboard */
export default function AdminIndex() {
  redirect("/admin/dashboard");
}
