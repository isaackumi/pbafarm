export async function getServerSideProps() {
  return {
    redirect: {
      destination: '/feed-purchases',
      permanent: false,
    },
  }
}

export default function FeedManagementPurchasesPage() {
  return null
}
