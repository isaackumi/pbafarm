export async function getServerSideProps() {
  return {
    redirect: {
      destination: '/feed-types',
      permanent: false,
    },
  }
}

export default function FeedManagementTypesPage() {
  return null
}
