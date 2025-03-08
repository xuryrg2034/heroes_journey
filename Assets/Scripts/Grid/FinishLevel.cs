using System;
using Core.Entities;
using Services.EventBus;
using UnityEngine;

namespace Grid
{
    [RequireComponent(typeof(Cell))]
    public class FinishLevel : MonoBehaviour
    {
        private Cell _cell;
        
        private void OnEnable()
        {
            EventBusService.Subscribe(Actions.BossDied, _activate);
        }

        private void OnDisable()
        {
            EventBusService.Unsubscribe(Actions.BossDied, _activate);
        }

        private void Start()
        {
            _cell = GetComponent<Cell>();
        }

        private void _activate()
        {
            _cell.SetType(CellType.Movable);
        }

        private void OnTriggerEnter2D(Collider2D other)
        {
            var isHero = other.GetComponent<Hero>() != null;

            if (isHero)
            {
                Debug.Log("Уровень завершен!");
            }
        }
    }
}