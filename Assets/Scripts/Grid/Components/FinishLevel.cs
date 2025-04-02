using Entities.Player;
using Services.EventBus;
using UnityEngine;

namespace Grid.Components
{
    public class FinishLevel : MonoBehaviour
    {
        [SerializeField] Vector3Int gridPosition;
        
        void OnEnable()
        {
            EventBusService.Subscribe(Actions.BossDied, _activate);
        }

        void OnDisable()
        {
            EventBusService.Unsubscribe(Actions.BossDied, _activate);
        }

        void Start()
        {
            
        }

        void _activate()
        {
            
        }

        void OnTriggerEnter2D(Collider2D other)
        {
            var isHero = other.GetComponent<Hero>() != null;

            if (isHero)
            {
                Debug.Log("Уровень завершен!");
            }
        }
    }
}