using UnityEngine;

namespace Entities.Enemies
{
    public class HitBox : MonoBehaviour
    {
        public BaseEntity Target { get; private set; } 
        
        private void OnTriggerEnter2D(Collider2D other)
        {
            var entity = other.GetComponent<BaseEntity>();
            if (entity != null)
            {
                Target = entity;
                // Debug.Log($"Это target: {entity.transform.position}");
            }
        }
        
        private void OnTriggerExit2D(Collider2D other)
        {
            var entity = other.GetComponent<BaseEntity>();
            if (entity && Target == entity)
            {
                Target = null;
            }
        }
    }
}