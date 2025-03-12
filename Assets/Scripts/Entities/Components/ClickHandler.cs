using UnityEngine;
using UnityEngine.Events;
using UnityEngine.EventSystems;

namespace Entities.Components
{
    [RequireComponent(typeof(BoxCollider2D))]
    public class ClickHandler : MonoBehaviour, IPointerClickHandler
    {
        public static readonly UnityEvent<BaseEntity> OnEntityClicked = new();

        private BaseEntity _baseEntity;

        private void Awake()
        {
            _baseEntity = GetComponent<BaseEntity>();
        }

        public void OnPointerClick(PointerEventData eventData)
        {
            OnEntityClicked?.Invoke(_baseEntity); // Уведомляем подписчиков о клике
        }
    }   
}