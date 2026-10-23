export async function onRequest(context) {
  return Response.json({
    success: true,
    message: "Hull Ag Solutions NDVI API is working"
  });
}
