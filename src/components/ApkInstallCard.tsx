import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Download, Smartphone } from 'lucide-react';
import QRCode from 'qrcode';

const APK_PATH = '/downloads/super-animator-studio.apk';

export const ApkInstallCard: React.FC = () => {
  const [qrCode, setQrCode] = useState<string | null>(null);

  useEffect(() => {
    void QRCode.toDataURL(`${window.location.origin}${APK_PATH}`, {
      width: 240,
      margin: 1,
    })
      .then(setQrCode)
      .catch(() => setQrCode(null));
  }, []);

  if (Capacitor.isNativePlatform()) return null;

  return (
    <div className="pt-5 border-t border-white/8 space-y-3">
      <span className="text-sm font-semibold text-white inline-flex items-center gap-2">
        <Smartphone className="w-4 h-4 text-emerald-400" />
        Aplicativo Android (APK)
      </span>
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        {qrCode && (
          <img
            src={qrCode}
            alt="QR code para baixar e instalar o app no celular"
            className="w-32 h-32 rounded-xl bg-white p-1.5 shrink-0"
          />
        )}
        <div className="space-y-2 max-w-md">
          <p className="text-xs text-slate-400">
            Aponte a câmera do celular para o QR code e instale o app nativo. Funciona 100% offline,
            sem loja de aplicativos.
          </p>
          <a
            href={APK_PATH}
            download
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            Baixar APK
          </a>
        </div>
      </div>
    </div>
  );
};
