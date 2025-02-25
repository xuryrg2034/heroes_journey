using UnityEngine;
using UnityEngine.EventSystems;
using Core.Entities;

namespace Services.Selection
{
    [RequireComponent(typeof(BoxCollider2D))]
    public class EntityClickHandler : MonoBehaviour, IPointerClickHandler
    {
        public static event System.Action<Entity> OnEntityClicked;

        private Entity _entity;

        private void Awake()
        {
            _entity = GetComponent<Entity>();
        }

        public void OnPointerClick(PointerEventData eventData)
        {
            OnEntityClicked?.Invoke(_entity); // Уведомляем подписчиков о клике
        }
    }   
}