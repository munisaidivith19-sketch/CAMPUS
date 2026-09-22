/**
 * Application root: providers, session bootstrap, and the router.
 *
 * On boot the app tries a silent refresh against the httpOnly cookie. Until that settles the
 * guards render a loading state rather than deciding — otherwise a page reload would briefly
 * look like a sign-out and bounce the user to the login screen.
 */
import { useEffect } from 'react';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { store, useAppDispatch } from '../store/index.js';
import { bootFinishedAnonymous, sessionEnded, sessionEstablished } from '../store/authSlice.js';
import { bootstrapSession, setSessionExpiredHandler } from '../lib/api.js';
import { AppRoutes } from '../routes/index.js';

function SessionBootstrap({ children }: { children: React.ReactNode }): JSX.Element {
  const dispatch = useAppDispatch();

  useEffect(() => {
    // When a refresh ultimately fails mid-session, drop to the anonymous state so the guards
    // send the user to sign in instead of leaving a half-dead UI.
    setSessionExpiredHandler(() => dispatch(sessionEnded()));

    void (async () => {
      const restored = await bootstrapSession();
      if (restored) {
        dispatch(sessionEstablished(restored));
      } else {
        dispatch(bootFinishedAnonymous());
      }
    })();
  }, [dispatch]);

  return <>{children}</>;
}

export function App(): JSX.Element {
  return (
    <Provider store={store}>
      <BrowserRouter>
        <SessionBootstrap>
          <AppRoutes />
        </SessionBootstrap>
      </BrowserRouter>
    </Provider>
  );
}
