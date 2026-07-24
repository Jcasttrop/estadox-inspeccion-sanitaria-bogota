"use client";

import { useState, useRef } from "react";

interface Props {
  onPhotoUploaded: (url: string) => void;
}

export function PhotoUpload({ onPhotoUploaded }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) return;

    // Show preview
    const reader = new FileReader();
    reader.onloadend = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);

    // Upload to Supabase Storage
    setUploading(true);
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, "_")}`;
      const { error } = await supabase.storage
        .from("report-photos")
        .upload(fileName, file, { contentType: file.type });

      if (error) throw error;

      const {
        data: { publicUrl },
      } = supabase.storage.from("report-photos").getPublicUrl(fileName);

      onPhotoUploaded(publicUrl);
    } catch (err) {
      console.error("Upload error:", err);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
          preview
            ? "border-green-300 bg-green-50"
            : "border-gray-200 hover:border-pereira-red/30 hover:bg-pereira-red-light/30"
        }`}
      >
        {preview ? (
          <div className="relative">
            <img
              src={preview}
              alt="Preview"
              className="mx-auto max-h-48 rounded-lg object-cover"
            />
            {uploading && (
              <div className="absolute inset-0 bg-white/70 flex items-center justify-center rounded-lg">
                <div className="w-8 h-8 border-4 border-gray-200 border-t-pereira-red rounded-full animate-spin" />
              </div>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setPreview(null);
                onPhotoUploaded("");
              }}
              className="absolute top-2 right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600"
            >
              X
            </button>
          </div>
        ) : (
          <div>
            <svg
              className="w-10 h-10 mx-auto text-gray-400 mb-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <p className="text-sm text-gray-500">
              Arrastra una foto o haz clic para seleccionar
            </p>
            <p className="text-xs text-gray-400 mt-1">
              JPG, PNG hasta 5MB (opcional)
            </p>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
        className="hidden"
      />
    </div>
  );
}
