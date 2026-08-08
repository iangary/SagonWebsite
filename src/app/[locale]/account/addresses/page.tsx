import { getTranslations } from 'next-intl/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { AddressBook } from './address-book'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'account' })
  return { title: t('addresses'), robots: { index: false } }
}

export default async function AddressesPage() {
  const user = await requireUser()

  const addresses = await db.address.findMany({
    where: { userId: user.id },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  })

  return <AddressBook addresses={addresses} />
}
