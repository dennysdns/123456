import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Film,
  Image as ImageIcon,
  Loader2,
  Pause,
  Pipette,
  Play,
  Upload,
} from 'lucide-react';
import { ChromaKeyConfig, GalleryItem, MediaFile } from '../../types/studio';
import { applyChromaKeyToImageData } from '../../utils/canvasRenderer';
import { ALL_ACCEPTED_EXTENSIONS, processImportedFile } from '../../utils/mediaImporter';
import { getBestSupportedVideoMime, triggerBlobDownload } from '../../utils/videoExporter';

interface VideoChromaKeyViewProps {
  mediaFiles: MediaFile[];
  onImportMedia: (files: MediaFile[]) => Promise<void>;
  onSaveToGallery: (item: GalleryItem) => Promise<void>;
  onOpenImageMode: () => void;
}

type BackdropMode = 'solid' | 'image';

interface BackdropConfig {
  mode: BackdropMode;
  color: string;
  image: HTMLImageElement | null;
  showKeyedPreview: boolean;
}

function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  backdrop: BackdropConfig
): void {
  if (backdrop.showKeyedPreview) return;
  if (backdrop.mode === 'image' && backdrop.image && backdrop.image.naturalWidth > 0) {
    const scale = Math.max(width / backdrop.image.naturalWidth, height / backdrop.image.naturalHeight);
    const dw = backdrop.image.naturalWidth * scale;
    const dh = backdrop.image.naturalHeight * scale;
    ctx.drawImage(backdrop.image, (width - dw) / 2, (height - dh) / 2, dw, dh);
    return;
  }
  ctx.fillStyle = backdrop.color;
  ctx.fillRect(0, 0, width, height);
}

function renderKeyedFrame(
  ctx: CanvasRenderingContext2D,
  source: HTMLVideoElement,
  width: number,
  height: number,
  config: ChromaKeyConfig,
  backdrop: BackdropConfig,
  scratch: HTMLCanvasElement
): void {
  if (scratch.width !== width) scratch.width = width;
  if (scratch.height !== height) scratch.height = height;
  const sctx = scratch.getContext('2d');
  if (!sctx) return;

  sctx.clearRect(0, 0, width, height);
  sctx.drawImage(source, 0, 0, width, height);
  const frame = sctx.getImageData(0, 0, width, height);
  applyChromaKeyToImageData(frame, config);
  sctx.putImageData(frame, 0, 0);

  ctx.clearRect(0, 0, width, height);
  drawBackdrop(ctx, width, height, backdrop);
  ctx.drawImage(scratch, 0, 0);
}

export const VideoChromaKeyView: React.FC<VideoChromaKeyViewProps> = ({
  mediaFiles,
  onImportMedia,
  onSaveToGallery,
  onOpenImageMode,
}) => {
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioGraphRef = useRef<{ ctx: AudioContext; dest: MediaStreamAudioDestinationNode } | null>(
    null
  );

  const videoMedia = mediaFiles.filter((m) => m.kind === 'video');
  const imageMedia = mediaFiles.filter((m) => m.kind === 'image');

  const [selectedMediaId, setSelectedMediaId] = useState<string>(videoMedia[0]?.id || '');
  const [config, setConfig] = useState<ChromaKeyConfig>({
    enabled: true,
    keyColor: '#00D13B',
    similarity: 36,
    smoothness: 14,
    spill: 35,
  });
  const [backdropMode, setBackdropMode] = useState<BackdropMode>('solid');
  const [backdropColor, setBackdropColor] = useState('#111827');
  const [backdropMediaId, setBackdropMediaId] = useState<string>('');
  const [showKeyedPreview, setShowKeyedPreview] = useState(false);
  const [eyedropperActive, setEyedropperActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const backdrop: BackdropConfig = {
    mode: backdropMode,
    color: backdropColor,
    image: bgImageRef.current,
    showKeyedPreview,
  };
  const backdropRef = useRef(backdrop);
  backdropRef.current = backdrop;
  const configRef = useRef(config);
  configRef.current = config;

  const selectedMedia = videoMedia.find((m) => m.id === selectedMediaId) || null;

  // Keep a single decodable <video> for the selected media file.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setPlaying(false);
    if (!selectedMedia) {
      video.removeAttribute('src');
      video.load();
      setVideoDuration(0);
      return;
    }
    const url = URL.createObjectURL(selectedMedia.blob);
    video.src = url;
    video.load();
    return () => {
      video.pause();
      URL.revokeObjectURL(url);
    };
  }, [selectedMedia?.id]);

  // Background image for "Fundo com imagem".
  useEffect(() => {
    const mf = imageMedia.find((m) => m.id === backdropMediaId);
    if (!mf) {
      bgImageRef.current = null;
      return;
    }
    const url = URL.createObjectURL(mf.blob);
    const img = new Image();
    img.onload = () => {
      bgImageRef.current = img;
      renderPreview();
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [backdropMediaId, imageMedia.length]);

  const renderPreview = useCallback(() => {
    const canvas = previewCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !video.videoWidth) return;
    const targetWidth = Math.min(960, video.videoWidth);
    const targetHeight = Math.round((targetWidth * video.videoHeight) / video.videoWidth);
    if (canvas.width !== targetWidth) canvas.width = targetWidth;
    if (canvas.height !== targetHeight) canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!scratchRef.current) scratchRef.current = document.createElement('canvas');
    renderKeyedFrame(
      ctx,
      video,
      targetWidth,
      targetHeight,
      configRef.current,
      backdropRef.current,
      scratchRef.current
    );
  }, []);

  // Redraw the paused frame whenever the key or background settings change.
  useEffect(() => {
    renderPreview();
  }, [config, backdropMode, backdropColor, backdropMediaId, showKeyedPreview, renderPreview]);

  // Live preview loop while the video plays.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playing) return;
    let raf = 0;
    const loop = () => {
      if (video.ended) {
        setPlaying(false);
        renderPreview();
        return;
      }
      renderPreview();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, renderPreview]);

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    setVideoDuration(Number.isFinite(video.duration) ? video.duration : 0);
    renderPreview();
  };

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video || !video.src) return;
    if (video.paused) {
      video.muted = true;
      if (video.ended) video.currentTime = 0;
      try {
        await video.play();
        setPlaying(true);
      } catch {
        setNotice('Não foi possível reproduzir este vídeo neste dispositivo.');
      }
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = previewCanvasRef.current;
    const video = videoRef.current;
    if (!eyedropperActive || !canvas || !video || !video.videoWidth) return;

    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) * canvas.width) / rect.width);
    const y = Math.floor(((e.clientY - rect.top) * canvas.height) / rect.height);

    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const octx = off.getContext('2d');
    if (!octx) return;
    octx.drawImage(video, 0, 0, off.width, off.height);
    const px = octx.getImageData(x, y, 1, 1).data;
    const hex = `#${[px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    setConfig((c) => ({ ...c, keyColor: hex }));
    setEyedropperActive(false);
  };

  const getAudioGraph = (video: HTMLVideoElement) => {
    if (audioGraphRef.current) return audioGraphRef.current;
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(video);
      const dest = ctx.createMediaStreamDestination();
      source.connect(dest);
      audioGraphRef.current = { ctx, dest };
      return audioGraphRef.current;
    } catch {
      return null;
    }
  };

  const handleExport = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !selectedMedia) {
      setNotice('Carregue um vídeo para remover o fundo.');
      return;
    }
    if (exporting) return;

    setExporting(true);
    setProgress(0);
    setNotice(null);

    const width = Math.min(1280, video.videoWidth);
    const height = Math.round((width * video.videoHeight) / video.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setExporting(false);
      return;
    }
    const scratch = document.createElement('canvas');

    video.pause();
    setPlaying(false);
    video.currentTime = 0;
    video.muted = false;

    const stream = canvas.captureStream(30);
    const audioGraph = getAudioGraph(video);
    let hasAudio = false;
    if (audioGraph) {
      if (audioGraph.ctx.state === 'suspended') {
        // Some environments (containers, machines without an output device) never
        // resolve resume(); never let the render wait forever on it.
        await Promise.race([
          audioGraph.ctx.resume().catch(() => undefined),
          new Promise((resolve) => window.setTimeout(resolve, 800)),
        ]);
      }
      audioGraph.dest.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
      hasAudio = audioGraph.dest.stream.getAudioTracks().length > 0;
    }

    const { mimeType, extension } = getBestSupportedVideoMime('mp4', hasAudio);
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 6_000_000,
        ...(hasAudio ? { audioBitsPerSecond: 128_000 } : {}),
      });
    } catch {
      recorder = new MediaRecorder(stream);
    }

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    };
    const stopped = new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }));
    });

    let withoutAudio = false;

    try {
      recorder.start(250);

      try {
        await Promise.race([
          video.play(),
          new Promise((_, reject) =>
            window.setTimeout(() => reject(new Error('play-timeout')), 4000)
          ),
        ]);
      } catch {
        // Autoplay with sound can be refused; muted playback keeps the render going.
        withoutAudio = true;
        video.muted = true;
        await video.play();
      }
      setPlaying(true);

      await new Promise<void>((resolve) => {
        let raf = 0;
        const onEnded = () => {
          cancelAnimationFrame(raf);
          window.clearTimeout(watchdog);
          video.removeEventListener('ended', onEnded);
          resolve();
        };
        const watchdog = window.setTimeout(onEnded, (video.duration || 10) * 1000 + 4000);
        video.addEventListener('ended', onEnded);
        const loop = () => {
          renderKeyedFrame(
            ctx,
            video,
            width,
            height,
            configRef.current,
            { ...backdropRef.current, showKeyedPreview: false },
            scratch
          );
          if (video.duration > 0) {
            setProgress(Math.min(99, Math.round((video.currentTime / video.duration) * 100)));
          }
          if (!video.ended) raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      });

      recorder.stop();
      const blob = await stopped;
      if (!blob.size) {
        setNotice('Não foi possível gerar o vídeo. Tente novamente com outro arquivo.');
        return;
      }

      const baseName = selectedMedia.name.replace(/\.[^.]+$/, '');
      const finalExtension = (recorder.mimeType || mimeType).includes('mp4') ? 'mp4' : extension;
      const filename = `${baseName}_semfundo_${Date.now()}.${finalExtension}`;
      const finalBlob = new Blob([blob], { type: recorder.mimeType || mimeType });

      triggerBlobDownload(finalBlob, filename);

      const imported = await processImportedFile(finalBlob, filename, 'videos');
      if (imported) await onImportMedia([imported]);

      await onSaveToGallery({
        id: `gal-${Date.now()}`,
        name: filename,
        kind: 'video',
        mimeType: finalBlob.type,
        size: finalBlob.size,
        width,
        height,
        blob: finalBlob,
        thumbnailDataUrl: canvas.toDataURL('image/jpeg', 0.75),
        createdAt: Date.now(),
      });

      setProgress(100);
      setNotice(
        withoutAudio
          ? 'Vídeo com o fundo substituído salvo no projeto (renderizado sem faixa de áudio).'
          : 'Vídeo com o fundo substituído salvo no projeto e na Minha Galeria!'
      );
    } catch {
      setNotice('Falha ao renderizar o vídeo. Feche outras abas pesadas e tente novamente.');
    } finally {
      video.pause();
      video.muted = true;
      setPlaying(false);
      setExporting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 pb-24 lg:pb-8 space-y-5">
      <input
        ref={fileInputRef}
        type="file"
        accept={ALL_ACCEPTED_EXTENSIONS}
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) {
            const m = await processImportedFile(file, file.name, 'videos');
            if (m && m.kind === 'video') {
              await onImportMedia([m]);
              setSelectedMediaId(m.id);
            }
          }
          e.target.value = '';
        }}
      />

      <div className="rounded-2xl bg-[#13161D] border border-white/8 p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-white">Chroma Key em Vídeo</h1>
          <p className="text-xs text-slate-400">
            Remove o fundo verde/azul do vídeo e substitui por cor ou imagem, com áudio preservado
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onOpenImageMode}
            className="min-h-[40px] px-3.5 rounded-xl bg-[#1A1E28] border border-white/12 text-xs font-semibold text-slate-200 hover:bg-white/10 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <ImageIcon className="w-4 h-4 text-cyan-400" />
            Modo Imagem
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[40px] px-3.5 rounded-xl bg-[#1A1E28] border border-white/12 text-xs font-semibold text-white hover:bg-white/10 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Upload className="w-4 h-4 text-amber-400" />
            Carregar Vídeo
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || !selectedMedia}
            className="min-h-[40px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-bold text-slate-950 inline-flex items-center gap-1.5 cursor-pointer"
          >
            {exporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {exporting ? `Renderizando ${progress}%` : 'Renderizar Vídeo'}
          </button>
        </div>
      </div>

      {notice && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5 text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {notice}
        </div>
      )}

      {videoMedia.length === 0 && !selectedMedia ? (
        <div className="rounded-2xl bg-[#13161D] border border-dashed border-white/12 p-10 text-center space-y-3">
          <Film className="w-10 h-10 mx-auto text-amber-400" />
          <h2 className="text-sm font-semibold text-white">Nenhum vídeo no projeto</h2>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Importe um vídeo gravado em tela verde ou azul (MP4, MOV, MKV, AVI ou WebM). O
            processamento acontece 100% offline no seu dispositivo.
          </p>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[40px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-xs font-bold text-slate-950 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            Carregar Vídeo
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 items-start">
          <div className="rounded-xl bg-[#13161D] border border-white/8 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <select
                value={selectedMediaId}
                onChange={(e) => setSelectedMediaId(e.target.value)}
                className="rounded-lg bg-[#0B0D11] border border-white/12 px-3 py-2 text-xs text-white max-w-xs"
              >
                {videoMedia.length === 0 && <option value="">Nenhum vídeo importado</option>}
                {videoMedia.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-2">
                <button
                  onClick={togglePlayback}
                  disabled={exporting || !selectedMedia}
                  className="min-h-[38px] px-3 rounded-lg bg-[#1A1E28] text-xs font-medium text-slate-200 hover:bg-white/10 disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  {playing ? 'Pausar' : 'Reproduzir'}
                </button>
                <button
                  onClick={() => setEyedropperActive((v) => !v)}
                  disabled={exporting}
                  className={`min-h-[38px] px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                    eyedropperActive
                      ? 'bg-cyan-500 text-slate-950 font-semibold'
                      : 'bg-[#1A1E28] text-slate-200 hover:bg-white/10'
                  }`}
                >
                  <Pipette className="w-4 h-4" />
                  {eyedropperActive ? 'Clique na cor no vídeo...' : 'Conta-Gotas'}
                </button>
              </div>
            </div>

            <div className="rounded-xl bg-checkerboard border border-white/10 overflow-hidden flex items-center justify-center p-2">
              <canvas
                ref={previewCanvasRef}
                onClick={handleCanvasClick}
                className={`max-h-[480px] w-auto object-contain ${
                  eyedropperActive ? 'cursor-crosshair' : 'cursor-default'
                }`}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <Film className="w-3.5 h-3.5" />
                {selectedMedia ? selectedMedia.name : 'Sem vídeo selecionado'}
                {videoDuration > 0 && ` · ${videoDuration.toFixed(1)}s`}
              </span>
              {showKeyedPreview && <span className="text-cyan-300">Prévia sem fundo (xadrez)</span>}
            </div>

            <video
              ref={videoRef}
              onLoadedMetadata={handleLoadedMetadata}
              onSeeked={renderPreview}
              playsInline
              className="absolute w-px h-px opacity-0 pointer-events-none"
            />

            {exporting && (
              <div className="space-y-1.5">
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-amber-500 transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-400">
                  Renderizando quadro a quadro com o fundo substituído...
                </p>
              </div>
            )}
          </div>

          <div className="rounded-xl bg-[#13161D] border border-white/8 p-4 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-white/8">
              <span className="text-sm font-semibold text-white">Parâmetros Chroma Key</span>
              <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                  className="accent-amber-500"
                />
                Ativo
              </label>
            </div>

            <div className="space-y-2">
              <label className="block text-xs text-slate-300">Cor Chave</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={config.keyColor}
                  onChange={(e) => setConfig({ ...config, keyColor: e.target.value })}
                  className="w-10 h-9 rounded bg-transparent cursor-pointer"
                />
                <button
                  onClick={() => setConfig({ ...config, keyColor: '#00D13B' })}
                  className="px-2.5 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 text-xs cursor-pointer"
                >
                  Verde
                </button>
                <button
                  onClick={() => setConfig({ ...config, keyColor: '#0047FF' })}
                  className="px-2.5 py-1.5 rounded-lg bg-blue-500/20 text-blue-300 text-xs cursor-pointer"
                >
                  Azul
                </button>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Tolerância / Similaridade</span>
                <span className="font-mono">{config.similarity}%</span>
              </div>
              <input
                type="range"
                min={1}
                max={90}
                value={config.similarity}
                onChange={(e) => setConfig({ ...config, similarity: Number(e.target.value) })}
                className="w-full accent-amber-500"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Suavização de Borda</span>
                <span className="font-mono">{config.smoothness}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={60}
                value={config.smoothness}
                onChange={(e) => setConfig({ ...config, smoothness: Number(e.target.value) })}
                className="w-full accent-cyan-400"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Supressão de Vazamento (Spill)</span>
                <span className="font-mono">{config.spill}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={config.spill}
                onChange={(e) => setConfig({ ...config, spill: Number(e.target.value) })}
                className="w-full accent-amber-500"
              />
            </div>

            <div className="pt-2 border-t border-white/8 space-y-2">
              <label className="block text-xs text-slate-300">Fundo do vídeo final</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setBackdropMode('solid')}
                  className={`py-2 rounded-lg text-xs font-medium cursor-pointer ${
                    backdropMode === 'solid'
                      ? 'bg-amber-500 text-slate-950 font-semibold'
                      : 'bg-[#1A1E28] text-slate-300'
                  }`}
                >
                  Cor Sólida
                </button>
                <button
                  onClick={() => setBackdropMode('image')}
                  className={`py-2 rounded-lg text-xs font-medium cursor-pointer ${
                    backdropMode === 'image'
                      ? 'bg-amber-500 text-slate-950 font-semibold'
                      : 'bg-[#1A1E28] text-slate-300'
                  }`}
                >
                  Imagem
                </button>
              </div>

              {backdropMode === 'solid' && (
                <input
                  type="color"
                  value={backdropColor}
                  onChange={(e) => setBackdropColor(e.target.value)}
                  className="w-full h-9 rounded bg-transparent cursor-pointer"
                />
              )}

              {backdropMode === 'image' && (
                <select
                  value={backdropMediaId}
                  onChange={(e) => setBackdropMediaId(e.target.value)}
                  className="w-full rounded-lg bg-[#0B0D11] border border-white/12 px-3 py-2 text-xs text-white"
                >
                  <option value="">Escolha uma imagem do projeto</option>
                  {imageMedia.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              )}

              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={showKeyedPreview}
                  onChange={(e) => setShowKeyedPreview(e.target.checked)}
                  className="accent-cyan-400"
                />
                Ver recorte sem fundo (prévia)
              </label>
            </div>

            <p className="text-[11px] leading-relaxed text-slate-500 pt-2 border-t border-white/8">
              A renderização acontece em tempo real no dispositivo com áudio original preservado. O
              fundo transparente é apenas de prévia: o vídeo exportado leva a cor ou a imagem
              escolhida acima.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
