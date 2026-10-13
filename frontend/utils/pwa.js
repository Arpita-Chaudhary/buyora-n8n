'use client';

import { useState, useEffect, useCallback } from 'react';

const PWA_INSTALLED_KEY = 'buyora_pwa_installed';

// Global variable to capture beforeinstallprompt before React components mount
let globalDeferredPrompt = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    globalDeferredPrompt = e;
    window.dispatchEvent(new CustomEvent('buyora_pwa_prompt_ready'));
  });

  window.addEventListener('appinstalled', () => {
    globalDeferredPrompt = null;
    localStorage.setItem(PWA_INSTALLED_KEY, 'true');
    window.dispatchEvent(new CustomEvent('buyora_pwa_installed'));
  });
}

/**
 * usePwa hook to integrate PWA installation across customer components.
 */
export function usePwa() {
  const [deferredPrompt, setDeferredPrompt] = useState(globalDeferredPrompt);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);
  const [platform, setPlatform] = useState('other'); // 'ios' | 'android' | 'desktop' | 'other'

  useEffect(() => {
    // 1. Detect if running standalone (already installed app)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true ||
      localStorage.getItem(PWA_INSTALLED_KEY) === 'true';

    setIsInstalled(isStandalone);

    // 2. Detect platform for custom instructions
    const ua = window.navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) {
      setPlatform('ios');
    } else if (/android/.test(ua)) {
      setPlatform('android');
    } else {
      setPlatform('desktop');
    }

    // 3. Listen for global prompt updates
    const handlePromptReady = () => {
      setDeferredPrompt(globalDeferredPrompt);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('buyora_pwa_prompt_ready', handlePromptReady);
    window.addEventListener('buyora_pwa_installed', handleAppInstalled);

    if (globalDeferredPrompt) {
      setDeferredPrompt(globalDeferredPrompt);
    }

    return () => {
      window.removeEventListener('buyora_pwa_prompt_ready', handlePromptReady);
      window.removeEventListener('buyora_pwa_installed', handleAppInstalled);
    };
  }, []);

  const triggerInstall = useCallback(async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
      globalDeferredPrompt = null;
    } else {
      // If native prompt isn't immediately triggerable (e.g. iOS or manual browser), open instructions modal
      setIsInstallModalOpen(true);
    }
  }, [deferredPrompt]);

  return {
    isInstallable: !!deferredPrompt || !isInstalled,
    isInstalled,
    deferredPrompt,
    triggerInstall,
    isInstallModalOpen,
    setIsInstallModalOpen,
    platform,
  };
}
