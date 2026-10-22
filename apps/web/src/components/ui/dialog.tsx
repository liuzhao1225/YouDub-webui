import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import styles from '../../../../../vendor/deepseek-harness/source/packages/client/ui-primitives/src/Modal.module.css'
import { cn } from '@/lib/utils'
import layout from './surfaces.module.css'

function Portal({ children, ...props }: BaseDialog.Portal.Props) { return <BaseDialog.Portal {...props}><div className={styles.root}>{children}</div></BaseDialog.Portal> }
function Backdrop(props: BaseDialog.Backdrop.Props) { return <BaseDialog.Backdrop {...props} className={styles.mask} /> }
function Popup({ className, ...props }: BaseDialog.Popup.Props) { return <BaseDialog.Popup {...props} className={cn(styles.dialog, layout.dialogContent, className)} /> }
function Title({ className, ...props }: BaseDialog.Title.Props) { return <BaseDialog.Title {...props} className={cn(styles.title, className)} /> }
export const Dialog = { ...BaseDialog, Portal, Backdrop, Popup, Title }
