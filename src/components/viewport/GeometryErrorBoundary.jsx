import { Component } from 'react';

// Catches render-time errors thrown while drawing geometry (e.g. degenerate or
// malformed paths produced by an extreme dimension edit) so a single bad shape
// shows an inline notice in the viewport instead of blanking the whole app.
export default class GeometryErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[GeometryErrorBoundary] render error:', error, info);
  }

  componentDidUpdate(prevProps) {
    // Recover automatically once the inputs change (e.g. the user fixes the
    // value or selects a different node), so the error state isn't sticky.
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <g pointerEvents="none">
          <text
            x={0}
            y={0}
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fontSize={14}
            fill="#e64980"
          >
            Could not render this shape — adjust the value and try again.
          </text>
        </g>
      );
    }
    return this.props.children;
  }
}
