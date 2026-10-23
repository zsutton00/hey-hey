import { Frame, type FrameProps } from '../../components/frame';

/** Render-only: draws the model its view-model function produced. */
export const DebugScreen = (props: FrameProps): React.JSX.Element => <Frame {...props} />;
