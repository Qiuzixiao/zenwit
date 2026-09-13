import { useCallback, useRef } from 'react'
import type { ConversationSlotProps, InputZone } from '../contract/slots.ts'
import { conversationPhase } from '../contract/snapshot.ts'
import css from './WorkbenchConversation.module.css'

/** Full props composed from the slot contract. */
export type WorkbenchConversationProps = ConversationSlotProps

export function WorkbenchConversation({
  sessionId, useSession, useSessions, useSessionPendingInteraction,
  useConversation, useInput, useComposerBlock,
  renderSlot, renderSlotChain, t,
}: WorkbenchConversationProps) {
  const session = useSession(s => s)
  const pendingInteraction = useSessionPendingInteraction(snapshot =>
    sessionId === undefined ? undefined : snapshot.get(sessionId))
  const conversation = useConversation(s => s)
  const shellPhase = session === undefined || conversation === undefined
    ? 'blank'
    : conversationPhase(session, conversation)
  const openState = session?.openState
  const inputState = useInput(s => s)
  const summaryBlank = useSessions(s => sessionId === undefined ? undefined : s.byId[sessionId]?.blank)
  // A plugin this package cannot import (ui-model-selection) says this session cannot
  // send; its reason is already localized by whoever raised it.
  const composerBlock = useComposerBlock(block => block)

  // Publishes the two live measurements floating View chrome reads off the
  // scroll body: the seat's height as --dsh-composer-height, so controls clear
  // the composer as it grows, and the scrollport's own height as
  // --dsh-conversation-viewport-height, so a control can sit in the band the
  // seat leaves visible. Callback ref, not an effect; stable identity prevents
  // observer churn while the first blank session fills the resident body
  // outlet.
  const seatObserver = useRef<ResizeObserver | null>(null)
  const seatResizeRef = useCallback((seat: HTMLDivElement | null): void => {
    seatObserver.current?.disconnect()
    seatObserver.current = null
    const scroller = seat?.parentElement ?? null
    if (seat === null || scroller === null) return
    seatObserver.current = new ResizeObserver(() => {
      scroller.style.setProperty('--dsh-composer-height', `${seat.offsetHeight}px`)
      scroller.style.setProperty(
        '--dsh-conversation-viewport-height',
        `${scroller.clientHeight}px`,
      )
    })
    seatObserver.current.observe(seat)
    seatObserver.current.observe(scroller)
  }, [])

  // Keep an unresolved restored session from briefly showing the wrong takeover.
  const parentAvailabilityPending = session?.subagent?.address.mode === 'continuable'
    && session.subagent.parentAvailable === undefined
  const settling = sessionId !== undefined && (
    (shellPhase === 'blank' && openState === 'loading' && summaryBlank !== true)
    || parentAvailabilityPending
  )
  const empty = sessionId === undefined
    || (shellPhase === 'blank' && (openState === 'open' || summaryBlank === true))
  const zone: InputZone | undefined =
    session === undefined || inputState === undefined ? undefined : { session, input: inputState }

  // Project selection belongs to the workbench. The resident input is inert
  // until it supplies a Session, without advertising a workspace picker.
  const inert = sessionId === undefined
  const blocked = !inert && composerBlock !== undefined
  const inputBar = renderSlot('conversation.composer.bar', {
    variant: 'composer',
    ...(inert
      ? {
        disabled: true,
        placeholder: t('placeholder.workspace'),
      }
      : blocked
        // `blocked`, not `disabled`: the bar refuses input either way, but a
        // block keeps the model seat live because choosing a model is how the
        // user clears it.
        ? { blocked: composerBlock, placeholder: composerBlock.reason }
        : {}),
  })

  const composerBar = (
    <div className={css.composerStack}>
      {zone !== undefined && renderSlot('conversation.input.dock', zone)}
      {inputBar}
    </div>
  )

  const phase = settling ? 'settling' : empty ? 'empty' : 'active'
  const composer = renderSlotChain(
    'conversation.composer',
    { sessionId, session, pendingInteraction },
    { fallback: composerBar, fallbackOnly: sessionId === undefined, overlay: true },
  )

  return (
    <section className={css.root} data-phase={phase} aria-busy={settling || undefined}>
      {empty && !settling && (
        <header className={css.emptyHeader}>
          {renderSlot('conversation.hero.agentPreset', {})}
        </header>
      )}
      {sessionId === undefined ? null : renderSlot('conversation.session.header', {})}
      <div className={css.body}>
        <div className={css.scrollBody} data-conversation-scroll="">
          {sessionId === undefined ? null : renderSlot('conversation.session', {})}
          <div ref={seatResizeRef} className={css.composerSeat} data-composer-seat="">
            {composer}
          </div>
        </div>
      </div>
    </section>
  )
}
