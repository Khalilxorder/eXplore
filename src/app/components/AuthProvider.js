'use client';
import { useState, useEffect, createContext, useContext, useRef, useCallback } from 'react';
import {
  supabase,
  clearBrowserAuthParams,
  finishAuthFromUrl,
  getSession,
  getGoogleAuthAvailability,
  hasAuthCallbackParams,
  isSupabaseConfigured,
  onAuthStateChange,
  signIn,
  signInWithGoogle,
  signOut as supabaseSignOut,
  signUp,
} from '../lib/supabase';
import {
  AUTH_REQUIRED_EVENT,
  deactivatePushToken,
  fetchAuthCapabilities,
  fetchGoogleAuthStatus,
} from '../lib/api';
import { addAppUrlOpenListener, closeExternalBrowser } from '../lib/mobile';
import { clearRememberedPushDevice, loadRememberedPushDevice } from '../lib/pushNotifications';

const AuthContext = createContext({
  user: null,
  session: null,
  loading: true,
  authError: '',
  clearAuthError: () => {},
  hasSupabase: false,
  googleAuthChecked: false,
  googleAuthEnabled: null,
  isAdmin: false,
  signIn,
  signInWithGoogle,
  signOut: () => Promise.resolve(),
  signUp,
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(() => Boolean(supabase));
  const [authError, setAuthError] = useState('');
  const [googleAuthChecked, setGoogleAuthChecked] = useState(() => !supabase);
  const [googleAuthEnabled, setGoogleAuthEnabled] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const userRef = useRef(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    if (!user?.id || !supabase) {
      return;
    }

    let active = true;

    const ensureUserProfile = async () => {
      try {
        const { data: profile, error: fetchError } = await supabase
          .from('private_chat_profiles')
          .select('user_id')
          .eq('user_id', user.id)
          .maybeSingle();

        if (fetchError) {
          console.error('[AuthProvider] Error fetching profile:', fetchError.message || fetchError);
          return;
        }

        if (profile) {
          return;
        }

        if (!active) return;

        const emailPart = user.email ? user.email.split('@')[0] : '';
        const namePart = user.user_metadata?.full_name || user.user_metadata?.name || user.user_metadata?.display_name || '';
        const baseName = (namePart || emailPart || 'user')
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_+|_+$/g, '');

        let baseUsername = baseName;
        if (baseUsername.length < 3) {
          baseUsername = (baseUsername + 'user').slice(0, 24);
        }
        if (baseUsername.length > 24) {
          baseUsername = baseUsername.slice(0, 24);
        }
        baseUsername = baseUsername.replace(/_+$/g, '');
        if (baseUsername.length < 3) {
          baseUsername = 'user';
        }

        let username = baseUsername;
        let isUnique = false;
        let attempts = 0;

        while (!isUnique && attempts < 10 && active) {
          const { data: existing, error: checkError } = await supabase
            .from('private_chat_profiles')
            .select('username')
            .eq('username', username)
            .maybeSingle();

          if (!checkError && !existing) {
            isUnique = true;
          } else {
            attempts++;
            const suffix = Math.floor(100 + Math.random() * 900).toString();
            const availableLength = 24 - suffix.length - 1;
            const prefix = baseUsername.slice(0, availableLength);
            username = `${prefix}_${suffix}`;
          }
        }

        if (!isUnique || !active) {
          return;
        }

        const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.user_metadata?.display_name || user.email?.split('@')[0] || username;
        const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || '';

        const { error: insertError } = await supabase
          .from('private_chat_profiles')
          .insert({
            user_id: user.id,
            username,
            display_name: String(displayName || username).trim().slice(0, 80),
            avatar_url: String(avatarUrl || '').trim(),
            updated_at: new Date().toISOString(),
          });

        if (insertError) {
          console.error('[AuthProvider] Error creating profile:', insertError.message || insertError);
        } else {
          console.log('[AuthProvider] Profile auto-created for username:', username);
        }
      } catch (err) {
        console.error('[AuthProvider] Failed to sync user profile:', err);
      }
    };

    void ensureUserProfile();

    return () => {
      active = false;
    };
  }, [user]);

  const deactivateCurrentPhone = useCallback(async () => {
    const rememberedDevice = loadRememberedPushDevice();
    if (!rememberedDevice?.token && !rememberedDevice?.device_id) {
      clearRememberedPushDevice();
      return;
    }

    try {
      await deactivatePushToken({
        token: rememberedDevice.token,
        device_id: rememberedDevice.device_id,
      });
    } catch (error) {
      // Ignore device cleanup failures during sign-out.
    }

    clearRememberedPushDevice();
  }, []);

  const performSignOut = useCallback(async () => {
    if (userRef.current?.id) {
      await deactivateCurrentPhone();
    }

    await supabaseSignOut();
  }, [deactivateCurrentPhone]);

  useEffect(() => {
    let active = true;
    let removeAppListener = null;
    let listenerSetupCancelled = false;

    const refreshAdminCapabilities = async (nextUser) => {
      if (!active) {
        return;
      }

      if (!nextUser?.id) {
        setIsAdmin(false);
        return;
      }

      try {
        const capabilities = await fetchAuthCapabilities();
        if (active) {
          setIsAdmin(Boolean(capabilities?.is_admin));
        }
      } catch {
        if (active) {
          setIsAdmin(false);
        }
      }
    };

    const applySession = (nextSession) => {
      if (!active) {
        return;
      }

      const nextUser = nextSession?.user || null;
      setSession(nextSession || null);
      setUser(nextUser);
      void refreshAdminCapabilities(nextUser);
    };

    const completePendingAuth = async (rawUrl, { clearBrowserUrl = false } = {}) => {
      const result = await finishAuthFromUrl(rawUrl);
      if (!active) {
        return result;
      }

      if (clearBrowserUrl) {
        clearBrowserAuthParams();
      }

      if (result?.error) {
        setAuthError(result.error);
      } else {
        setAuthError('');
      }

      const latestSession = result?.session || await getSession();
      applySession(latestSession);
      return result;
    };

    const initializeAuth = async () => {
      if (!supabase) {
        return;
      }

      const googleAuthAvailabilityPromise = Promise.allSettled([
        getGoogleAuthAvailability(),
        fetchGoogleAuthStatus(6000),
      ]);

      if (typeof window !== 'undefined' && hasAuthCallbackParams(window.location.href)) {
        await completePendingAuth(window.location.href, { clearBrowserUrl: true });
      } else {
        applySession(await getSession());
      }

      const googleAuthResults = await googleAuthAvailabilityPromise;
      const directAvailability = googleAuthResults[0]?.status === 'fulfilled'
        ? googleAuthResults[0].value
        : null;
      const backendProbe = googleAuthResults[1]?.status === 'fulfilled'
        ? googleAuthResults[1].value
        : null;
      const googleAuthAvailability = typeof directAvailability === 'boolean'
        ? directAvailability
        : (backendProbe?.status === 'live' ? true : null);
      if (active) {
        setGoogleAuthEnabled(googleAuthAvailability);
        setGoogleAuthChecked(true);
      }

      if (active) {
        setLoading(false);
      }
    };

    if (!supabase) {
      return;
    }

    const { data } = onAuthStateChange((_event, nextSession) => {
      applySession(nextSession);
      setLoading(false);
    });

    const handleNativeAuthUrl = async (event) => {
      if (!event?.url || !hasAuthCallbackParams(event.url)) {
        return;
      }

      setLoading(true);
      await completePendingAuth(event.url);
      await closeExternalBrowser();
      if (active) {
        setLoading(false);
      }
    };

    const handleAuthRequired = async () => {
      const latestSession = await getSession();
      if (latestSession?.user) {
        applySession(latestSession);
        setLoading(false);
        return;
      }

      setAuthError('Your session expired or this action needs sign-in. Please sign in again.');
      applySession(null);
      setLoading(false);
      void performSignOut();
    };

    const handleWindowFocus = async () => {
      if (!active) {
        return;
      }

      try {
        const latestSession = await getSession();
        if (latestSession?.user || userRef.current) {
          applySession(latestSession);
          setLoading(false);
        }
      } catch {
        // Focus recovery is best-effort after an external OAuth browser returns.
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
      window.addEventListener('focus', handleWindowFocus);
    }

    void (async () => {
      const removeListener = await addAppUrlOpenListener(handleNativeAuthUrl);
      if (listenerSetupCancelled && typeof removeListener === 'function') {
        removeListener();
        return;
      }

      removeAppListener = removeListener;
    })();
    void initializeAuth();

    return () => {
      active = false;
      listenerSetupCancelled = true;
      data?.subscription?.unsubscribe();
      if (typeof window !== 'undefined') {
        window.removeEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
        window.removeEventListener('focus', handleWindowFocus);
      }
      if (typeof removeAppListener === 'function') {
        removeAppListener();
      }
    };
  }, [performSignOut]);

  const sessionIsAdmin = Boolean(user?.id && isAdmin);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        authError,
        clearAuthError: () => setAuthError(''),
        hasSupabase: isSupabaseConfigured(),
        googleAuthChecked,
        googleAuthEnabled,
        isAdmin: sessionIsAdmin,
        signIn,
        signInWithGoogle,
        signUp,
        signOut: performSignOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
