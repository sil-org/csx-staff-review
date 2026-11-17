import { useState } from 'react'
import { MessageSquare, X, Angry, Frown, Meh, Smile, Laugh } from 'lucide-react'

const RATINGS = [
  { value: 1, label: 'Very unhappy', Icon: Angry },
  { value: 2, label: 'Unhappy', Icon: Frown },
  { value: 3, label: 'Neutral', Icon: Meh },
  { value: 4, label: 'Happy', Icon: Smile },
  { value: 5, label: 'Very happy', Icon: Laugh },
]

// Floating feedback trigger — bottom-right blue button. `onSend` does the
// actual delivery (each app wires its own email backend — see lib/email.js
// and supabase/functions/send-email); this component only owns the
// rating/comment UI and the open/sending/sent/error states.
export default function FeedbackWidget({ onSend }) {
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState(null)
  const [comment, setComment] = useState('')
  const [status, setStatus] = useState('idle') // idle | sending | sent | error

  async function handleSend() {
    setStatus('sending')
    try {
      await onSend({ rating, comment })
      setStatus('sent')
      setTimeout(() => {
        setOpen(false)
        setStatus('idle')
        setRating(null)
        setComment('')
      }, 1500)
    } catch {
      setStatus('error')
    }
  }

  return (
    <>
      {open && (
        <div className="fixed bottom-20 right-5 z-40 w-72 bg-white rounded-xl shadow-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-gray-800">How's it going?</p>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600" aria-label="Close">
              <X size={16} />
            </button>
          </div>

          {status === 'sent' ? (
            <p className="text-sm text-gray-700 py-2">Feedback sent — thank you!</p>
          ) : (
            <>
              <div className="flex justify-between mb-3">
                {RATINGS.map(({ value, label, Icon }) => (
                  <button
                    key={value}
                    onClick={() => setRating(value)}
                    title={label}
                    aria-label={label}
                    className={`p-2 rounded-full transition-colors ${
                      rating === value ? 'bg-brand text-white' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
                    }`}
                  >
                    <Icon size={20} />
                  </button>
                ))}
              </div>

              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Anything you'd like us to know? (optional)"
                rows={3}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm mb-3 resize-none"
              />

              {status === 'error' && (
                <p className="text-xs text-red-600 mb-2">Couldn't send that — try again?</p>
              )}

              <button
                onClick={handleSend}
                disabled={(!rating && !comment) || status === 'sending'}
                className="w-full bg-brand text-white text-sm font-medium rounded-md px-4 py-2 hover:opacity-90 disabled:opacity-40"
              >
                {status === 'sending' ? 'Sending…' : 'Send feedback'}
              </button>
            </>
          )}
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-5 right-5 z-40 bg-brand text-white rounded-full p-3.5 shadow-lg hover:opacity-90 transition"
        aria-label="Give feedback"
      >
        <MessageSquare size={20} />
      </button>
    </>
  )
}
