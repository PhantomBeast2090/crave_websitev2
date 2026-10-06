import { useState } from 'react'
import { useReadyAuth } from '../../state/auth'
import { Page, PageHeading, Panel, Badge } from '../../ui/kit'
import { useToast } from '../../state/toast'
import { friendlyError, logError } from '../../lib/errors'
import { supabase } from '../../lib/supabase'

const roleLabel = { STUDENT: 'Student', VENDOR: 'Vendor', ADMIN: 'Management', PENDING_VENDOR: 'Vendor (pending)' } as const

export function ProfilePage() {
  const { profile, signOut } = useReadyAuth()
  const toast = useToast()
  const [name, setName] = useState(profile.name)
  const [phone, setPhone] = useState(profile.phone ?? '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const cleanName = name.trim()
    if (cleanName.length < 2 || cleanName.length > 80) return toast.show('Enter a name between 2 and 80 characters.', 'red')
    if (phone && !/^[0-9+\-\s]{7,15}$/.test(phone)) return toast.show('Enter a valid phone number.', 'red')
    setBusy(true)
    const { error } = await supabase!.from('profiles').update({ name: cleanName, phone: phone.trim() || null }).eq('id', profile.id)
    setBusy(false)
    if (error) { logError('profile:save', error); return toast.show(friendlyError(error, 'Could not save your profile.'), 'red') }
    toast.show('Profile saved', 'green')
  }

  return <Page>
    <PageHeading eyebrow="YOUR CRAVE ID" title={<>Hi, <em>{profile.name.split(' ')[0]}.</em></>} action={<button type="button" className="button button-dark" onClick={() => void signOut()}>Sign out <span aria-hidden="true">↗</span></button>} />
    <div className="panel-grid">
      <Panel title="Account" eyebrow="WHO YOU ARE">
        <dl className="stack" style={{ margin: 0 }}>
          <div><dt className="eyebrow">Email</dt><dd style={{ margin: '4px 0 0' }}>{profile.email}</dd></div>
          <div><dt className="eyebrow">Access</dt><dd style={{ margin: '4px 0 0' }}><Badge tone="orange">{roleLabel[profile.role]}</Badge> <span className="muted" style={{ fontSize: 13 }}>assigned by Crave, not editable here</span></dd></div>
        </dl>
      </Panel>
      <Panel title="Your details" eyebrow="EDIT">
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void save() }}>
          <div className="field"><label htmlFor="pf-name">Name</label><input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" /></div>
          <div className="field"><label htmlFor="pf-phone">Phone (optional)</label><input id="pf-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={15} inputMode="tel" autoComplete="tel" /></div>
          <button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </form>
      </Panel>
    </div>
  </Page>
}
