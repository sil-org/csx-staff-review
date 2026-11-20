import { Routes, Route, Navigate } from 'react-router-dom'
import Home from './pages/Home'
import AuthCallback from './pages/AuthCallback'
import MyGoals from './pages/MyGoals'
import MyReviews from './pages/MyReviews'
import Team from './pages/Team'
import TeamManagerReview from './pages/TeamManagerReview'
import TeamPersonGoals from './pages/TeamPersonGoals'
import LaunchReviews from './pages/LaunchReviews'
import AdminQuestions from './pages/admin/Questions'
import AdminParticipants from './pages/admin/Participants'
import AdminDepartments from './pages/admin/Departments'
import RequireAuth from './components/RequireAuth'

// Role checks for the admin pages are cosmetic here (nav visibility); Postgres enforces them.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/goals" element={<RequireAuth><MyGoals /></RequireAuth>} />
      <Route path="/reviews" element={<RequireAuth><MyReviews /></RequireAuth>} />
      <Route path="/team" element={<RequireAuth><Team /></RequireAuth>} />
      <Route path="/team/:email/review/:reviewId" element={<RequireAuth><TeamManagerReview /></RequireAuth>} />
      <Route path="/team/:email/goals" element={<RequireAuth><TeamPersonGoals /></RequireAuth>} />
      <Route path="/launch" element={<RequireAuth><LaunchReviews /></RequireAuth>} />
      <Route path="/admin/questions" element={<RequireAuth><AdminQuestions /></RequireAuth>} />
      <Route path="/admin/participants" element={<RequireAuth><AdminParticipants /></RequireAuth>} />
      <Route path="/admin/departments" element={<RequireAuth><AdminDepartments /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
