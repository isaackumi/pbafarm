export async function getServerSideProps() {
  return {
    redirect: {
      destination: '/feed-suppliers',
      permanent: false,
    },
  }
}

export default function FeedManagementSuppliersPage() {
  return null
}
