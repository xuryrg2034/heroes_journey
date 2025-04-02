using System;
using Entities.Player;
using Services.EventBus;
using UnityEngine;

namespace Grid.Components
{
    public class FinishLevel : MonoBehaviour
    {
        [SerializeField] UnityEngine.Grid grid;

        BoxCollider2D _boxCollider;
        
        Vector3Int _gridPosition;
        
        void OnDrawGizmos()
        {
            Gizmos.color = Color.magenta;
            Gizmos.DrawWireCube(transform.position, Vector3.one); // размер клетки 1x1
        }

        void OnEnable()
        {
            EventBusService.Subscribe(Actions.BossDied, Activate);
        }

        void OnDisable()
        {
            EventBusService.Unsubscribe(Actions.BossDied, Activate);
        }

        void Start()
        {
            _gridPosition = grid.WorldToCell(transform.position);
            _boxCollider =  GetComponent<BoxCollider2D>();
            
            _boxCollider.enabled = false;
        }

        void Activate()
        {
            _boxCollider.enabled = true;
        }

        void OnTriggerEnter2D(Collider2D other)
        {
            var hero = other.GetComponent<Hero>();

            if (hero == null) return;

            if (_gridPosition == hero.GridPosition)
            {
                Debug.Log("Уровень завершен!");   
            }
        }
    }
}