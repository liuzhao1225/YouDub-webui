"use client"

import { useI18n } from "@/lib/i18n"
import { useV1Text } from "@/lib/v1-ui"
import { PageHeader } from "@/components/page-header"
import { V1SettingsForm } from "@/components/v1-settings-form"

export default function SettingsPage() {
  const { t } = useI18n()
  const text = useV1Text()
  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 lg:py-12">
      <PageHeader
        title={t.nav.settings}
        description={text(
          "Interface language, the translation service connection, and the models available on this computer.",
          "界面语言、翻译服务连接，以及本机可用的模型。",
          "表示言語、翻訳サービスの接続、この端末で利用できるモデル。",
        )}
      />
      <div className="mt-8">
        <V1SettingsForm />
      </div>
    </div>
  )
}
