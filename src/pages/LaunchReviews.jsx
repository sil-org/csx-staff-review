import Page, { Todo } from '../components/Page'

export default function LaunchReviews() {
  return (
    <Page title="Launch reviews">
      <Todo>Pick a department and a review, edit the email (rich text), send. See design/Launch-Reviews.dc.html. RPCs: rev_launch_preview, rev_launch_cycle, rev_department_report, rev_department_status.</Todo>
    </Page>
  )
}
